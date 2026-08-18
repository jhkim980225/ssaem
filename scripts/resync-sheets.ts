// 시트에 아직 못 보낸 응시 결과를 밀어 넣는다.
//
//   npx tsx scripts/resync-sheets.ts          # 미전송분 전송
//   npx tsx scripts/resync-sheets.ts --dry    # 보내지 않고 대상만 확인
//
// 언제 쓰나:
//  - 시트 연동을 나중에 켰을 때 (그동안 쌓인 결과를 한 번에)
//  - 제출 시점에 시트가 느리거나 실패해 synced=false로 남았을 때
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { appendResultRows, sheetsConfigured } from "../src/lib/sheets";
import type { ResultRow } from "../src/lib/results-csv";

config({ path: ".env.local" });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const DRY = process.argv.includes("--dry");
const BATCH = 200; // 한 번에 보낼 행 수 (시트 API 부담 방어)

async function main() {
  if (!sheetsConfigured()) {
    console.error(
      "구글시트가 설정돼 있지 않아요.\n" +
        "GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY, GOOGLE_SHEET_ID를 .env.local에 넣어 주세요.\n" +
        "(docs/구글시트-연동-가이드.md 참고)"
    );
    process.exit(1);
  }

  const { data: attempts, error } = await db
    .from("assessment_attempts")
    .select("id, assessment_id, student_id, score, total, submitted_at")
    .eq("synced", false)
    .order("submitted_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  if (!attempts?.length) {
    console.log("미전송 응시 없음 — 전부 동기화돼 있어요.");
    return;
  }
  console.log(`미전송 응시 ${attempts.length}건`);

  // 필요한 부속 정보를 한 번에 모은다 (응시별 쿼리 반복 방지)
  const setIds = [...new Set(attempts.map((a) => a.assessment_id))];
  const stuIds = [...new Set(attempts.map((a) => a.student_id))];
  const attIds = attempts.map((a) => a.id);

  const [{ data: sets }, { data: students }, { data: responses }, { data: questions }, { data: sigs }] =
    await Promise.all([
      db.from("assessments").select("id, title, teacher_id").in("id", setIds),
      db.from("profiles").select("id, name").in("id", stuIds),
      db.from("assessment_responses").select("attempt_id, question_id, correct").in("attempt_id", attIds),
      db.from("assessment_questions").select("id, assessment_id, ord").in("assessment_id", setIds),
      db.from("signatures").select("ref_id, signed_at").eq("kind", "assessment").in("ref_id", attIds),
    ]);

  const teacherIds = [...new Set((sets ?? []).map((s) => s.teacher_id))];
  const { data: teachers } = teacherIds.length
    ? await db.from("profiles").select("id, name, academy_id").in("id", teacherIds)
    : { data: [] as { id: string; name: string; academy_id: string | null }[] };
  const academyIds = [...new Set((teachers ?? []).map((t) => t.academy_id).filter(Boolean))] as string[];
  const { data: academies } = academyIds.length
    ? await db.from("academies").select("id, name").in("id", academyIds)
    : { data: [] as { id: string; name: string }[] };

  const setOf = new Map((sets ?? []).map((s) => [s.id, s]));
  const nameOf = new Map((students ?? []).map((s) => [s.id, s.name]));
  const teacherOf = new Map((teachers ?? []).map((t) => [t.id, t]));
  const academyOf = new Map((academies ?? []).map((a) => [a.id, a.name]));
  const signedOf = new Map((sigs ?? []).map((s) => [s.ref_id, s.signed_at]));

  // 평가별 문항 순서
  const orderOf = new Map<string, string[]>();
  for (const q of (questions ?? []).sort((a, b) => a.ord - b.ord)) {
    const arr = orderOf.get(q.assessment_id) ?? [];
    arr.push(q.id);
    orderOf.set(q.assessment_id, arr);
  }
  // 응시별 문항 정오
  const marksOf = new Map<string, Map<string, boolean>>();
  for (const r of responses ?? []) {
    const m = marksOf.get(r.attempt_id) ?? new Map<string, boolean>();
    m.set(r.question_id, r.correct);
    marksOf.set(r.attempt_id, m);
  }

  const rows: (ResultRow & { _id: string })[] = attempts.map((a) => {
    const set = setOf.get(a.assessment_id);
    const teacher = set ? teacherOf.get(set.teacher_id) : undefined;
    const order = orderOf.get(a.assessment_id) ?? [];
    const m = marksOf.get(a.id) ?? new Map<string, boolean>();
    return {
      _id: a.id,
      submittedAt: a.submitted_at,
      academy: teacher?.academy_id ? academyOf.get(teacher.academy_id) ?? "" : "",
      teacher: teacher?.name ?? "",
      assessment: set?.title ?? "",
      student: nameOf.get(a.student_id) ?? "",
      score: a.score,
      total: a.total,
      percent: a.total ? Math.round((a.score / a.total) * 100) : 0,
      signedAt: signedOf.get(a.id) ?? "",
      marks: order.map((qid) => (m.has(qid) ? (m.get(qid) ? "O" : "X") : "-")).join(""),
    };
  });

  if (DRY) {
    for (const r of rows.slice(0, 10))
      console.log(`  ${r.submittedAt.slice(0, 16)} ${r.student} · ${r.assessment} ${r.score}/${r.total}`);
    if (rows.length > 10) console.log(`  … 외 ${rows.length - 10}건`);
    console.log("\n--dry 모드라 실제 전송은 하지 않았어요.");
    return;
  }

  let sent = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const res = await appendResultRows(chunk);
    if (!res.ok) {
      console.error(`전송 실패 (${i + 1}~${i + chunk.length}번째): ${res.error}`);
      break; // 실패분은 synced=false로 남으니 다음 실행에서 다시 시도된다
    }
    // 전송에 성공한 것만 표시 — 중복 전송 방지
    const { error: uerr } = await db
      .from("assessment_attempts")
      .update({ synced: true })
      .in("id", chunk.map((c) => c._id));
    if (uerr) {
      console.error("synced 갱신 실패:", uerr.message, "— 다음 실행 때 중복 전송될 수 있어요.");
      break;
    }
    sent += chunk.length;
    console.log(`  ${sent}/${rows.length} 전송`);
  }
  console.log(`\n완료 — ${sent}건 전송`);
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
