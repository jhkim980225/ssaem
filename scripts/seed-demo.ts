// 데모 시드: 학생 4명 + 최근 14일 분산 대화 + 피드백.
// 목적: 원장 인사이트 그래프·강사별 도움됨/아쉬움·미해결 큐를 실데이터로 채움.
// 실행: npx tsx scripts/seed-demo.ts  (재실행 시 기존 데모 대화 삭제 후 재생성 — idempotent)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const PW = process.env.SEED_PASSWORD || "12345678";
const TAG = "[데모]"; // 재실행 정리를 위한 대화 제목 접두어

const STUDENTS = ["김민준", "이서연", "박지호", "최수아"];

// 질문/답변 풀 — 전산회계 계열 (김대차), 일반
const QA = [
  ["차변과 대변이 항상 같아야 하는 이유가 뭐예요?", "거래의 이중성 때문이에요. 하나의 거래는 반드시 차변 요소와 대변 요소를 함께 만들어요. 그래서 합계는 항상 일치해요."],
  ["선급비용이랑 미지급비용 차이 알려주세요", "선급비용은 돈은 먼저 냈지만 아직 비용이 아닌 것(자산), 미지급비용은 비용은 발생했지만 아직 안 낸 것(부채)이에요."],
  ["감가상각 정액법 계산 어떻게 해요?", "(취득원가 - 잔존가치) ÷ 내용연수예요. 매년 같은 금액을 비용으로 인식해요."],
  ["시산표에서 안 잡히는 오류엔 뭐가 있나요?", "차대변 양쪽에 같은 금액으로 잘못 적은 오류, 거래 전체 누락, 이중 기입은 시산표로 못 잡아요."],
  ["부가세 예정신고는 누가 하나요?", "법인은 분기마다 예정신고를 해요. 개인 일반과세자는 원칙적으로 예정고지로 대신하고, 고지 금액이 일정 미만이면 생략돼요."],
  ["대손충당금 설정 분개 알려주세요", "결산 때 (차) 대손상각비 (대) 대손충당금으로 설정해요. 매출채권의 회수 불능 예상액만큼요."],
  ["재고자산 평가에서 선입선출법 특징이 뭐예요?", "먼저 산 것이 먼저 팔린다고 가정해요. 물가 상승기엔 매출원가가 작아지고 기말재고와 이익이 커져요."],
  ["결산 수정분개는 왜 하는 거예요?", "현금 흐름과 무관하게 그 기간의 수익·비용을 올바르게 귀속시키기 위해서예요. 선급·미지급·감가상각이 대표적이에요."],
];

async function ensureStudent(name: string, i: number, academyId: string): Promise<string | null> {
  const email = `s0${i + 1}@a.test`;
  const { data: created, error } = await db.auth.admin.createUser({ email, password: PW, email_confirm: true });
  let uid = created?.user?.id ?? null;
  if (error) {
    const { data: list } = await db.auth.admin.listUsers();
    uid = list?.users.find((x) => x.email === email)?.id ?? null;
  }
  if (!uid) return null;
  await db.from("profiles").upsert({ id: uid, academy_id: academyId, role: "student", name });
  return uid;
}

async function main() {
  const { data: academy } = await db.from("academies").select("id").eq("slug", process.env.DEFAULT_ACADEMY_SLUG || "default").maybeSingle();
  if (!academy) throw new Error("학원 없음 — scripts/seed.ts 먼저 실행");

  // 기존 데모 대화 정리 (messages·citations·feedback은 FK cascade)
  const { data: old } = await db.from("conversations").select("id").like("title", `${TAG}%`);
  if (old?.length) {
    await db.from("conversations").delete().in("id", old.map((c) => c.id));
    console.log(`기존 데모 대화 ${old.length}건 삭제`);
  }

  // 학생 4명
  const studentIds: string[] = [];
  for (let i = 0; i < STUDENTS.length; i++) {
    const uid = await ensureStudent(STUDENTS[i], i, academy.id);
    if (uid) studentIds.push(uid);
  }
  console.log(`학생 ${studentIds.length}명 준비`);

  // 대상 강사: 자료 많은 순 상위 3명
  const { data: teachers } = await db
    .from("profiles")
    .select("id, name, documents(count)")
    .eq("academy_id", academy.id)
    .eq("role", "teacher");
  type TRow = { id: string; name: string; documents: { count: number }[] };
  const top = ((teachers ?? []) as TRow[])
    .sort((a, b) => (b.documents?.[0]?.count ?? 0) - (a.documents?.[0]?.count ?? 0))
    .slice(0, 3);

  // 최근 14일 분산 대화 — 날짜별 0~3건, 주말 적게. 결정적 패턴(랜덤 없이 재현 가능)
  let convs = 0;
  let fbUp = 0;
  let fbDown = 0;
  for (let day = 13; day >= 0; day--) {
    const date = new Date(Date.now() - day * 86_400_000);
    const dow = date.getDay();
    const perDay = dow === 0 || dow === 6 ? (day % 2) : 1 + ((day * 7) % 3); // 주말 0~1, 평일 1~3
    for (let k = 0; k < perDay; k++) {
      const teacher = top[(day + k) % top.length];
      const student = studentIds[(day * 3 + k) % studentIds.length];
      const [q, a] = QA[(day + k * 3) % QA.length];
      const at = new Date(date);
      at.setHours(15 + k, (day * 13) % 60, 0, 0);

      const { data: conv } = await db
        .from("conversations")
        .insert({ teacher_id: teacher.id, student_id: student, title: `${TAG} ${q.slice(0, 40)}`, created_at: at.toISOString() })
        .select("id")
        .single();
      if (!conv) continue;
      convs++;

      await db.from("messages").insert({ conversation_id: conv.id, role: "user", content: q, created_at: at.toISOString() });
      const { data: am } = await db
        .from("messages")
        .insert({ conversation_id: conv.id, role: "assistant", content: a, model: "demo-seed", created_at: new Date(at.getTime() + 20_000).toISOString() })
        .select("id")
        .single();

      // 피드백: 3건 중 2건 도움됨, 7번째마다 아쉬움 (미해결 큐 데모용)
      if (am) {
        if (convs % 7 === 0) {
          await db.from("message_feedback").insert({ message_id: am.id, rating: 1 });
          fbDown++;
        } else if (convs % 3 !== 0) {
          await db.from("message_feedback").insert({ message_id: am.id, rating: 5 });
          fbUp++;
        }
      }
    }
  }
  console.log(`대화 ${convs}건 (강사 ${top.map((t) => t.name).join("·")}), 피드백 도움됨 ${fbUp}·아쉬움 ${fbDown}`);
  console.log("완료 — 원장 대시보드 그래프·강사별 평가·미해결 큐 확인");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
