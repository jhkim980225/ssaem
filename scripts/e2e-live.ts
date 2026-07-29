// 라이브 E2E: dev 서버(localhost:3000) + 실제 Supabase 필요.
// npx tsx scripts/e2e-live.ts
import assert from "node:assert";
import { config } from "dotenv";
config({ path: ".env.local" });

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function json(method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, data: await r.json().catch(() => null) };
}

async function login(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token ?? null;
}

let pass = 0;
function ok(cond: boolean, name: string) {
  assert.ok(cond, `FAIL: ${name}`);
  pass++;
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log("1) 강사 목록");
  const t = await json("GET", "/api/teachers");
  ok(t.status === 200 && t.data.teachers.length >= 1, "강사 목록 조회");
  const teacher = t.data.teachers.find((x: { name: string }) => x.name === "김대차") ?? t.data.teachers[0];

  console.log("2) RAG 답변 (스트리밍)");
  const r1 = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: teacher.id, question: "차변에는 뭘 기입해요?" }),
  });
  const convId = r1.headers.get("x-conversation-id");
  const sources = r1.headers.get("x-sources");
  const answer = await r1.text();
  ok(r1.status === 200 && answer.length > 30, "답변 스트림 수신");
  ok(!!convId, "대화 ID 헤더");
  ok(!!sources && JSON.parse(decodeURIComponent(sources)).length > 0, "출처 헤더");
  ok(/차변|8요소/.test(answer), "답변이 자료 근거 반영");

  console.log("3) 이어지는 질문 (맥락)");
  const r2 = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: teacher.id, question: "방금 설명 한 줄로 요약해줘", conversationId: convId }),
  });
  ok(r2.status === 200 && (await r2.text()).length > 10, "후속 질문 답변");

  console.log("4) 피드백");
  const fb = await json("POST", "/api/feedback", { conversationId: convId, rating: 5 });
  ok(fb.status === 200 && fb.data.ok, "피드백 기록");

  console.log("5) 강사 로그인");
  let ttoken: string | null = null;
  for (const pw of [process.env.SEED_PASSWORD, "12345678", "123456"]) {
    if (!pw) continue;
    ttoken = await login("t01@a.test", pw);
    if (ttoken) break;
  }
  ok(!!ttoken, "강사 로그인 (t01@a.test)");

  console.log("6) 강사 API");
  const docs = await json("GET", "/api/documents", undefined, ttoken!);
  ok(docs.status === 200 && docs.data.documents.length >= 1, "문서 목록");
  const c = await json("POST", "/api/courses", { title: "E2E 테스트반" }, ttoken!);
  ok(c.status === 200 && c.data.id, "강좌 생성");
  const pub = await json("GET", `/api/courses?teacher=${teacher.id}`);
  ok(pub.status === 200 && pub.data.courses.some((x: { id: string }) => x.id === c.data.id), "공개 강좌 목록");
  const del = await json("DELETE", `/api/courses?id=${c.data.id}`, undefined, ttoken!);
  ok(del.status === 200, "강좌 삭제");
  const ins = await json("GET", "/api/insights", undefined, ttoken!);
  ok(ins.status === 200 && ins.data.totals.questions >= 1, "인사이트 집계");
  const convs = await json("GET", "/api/conversations", undefined, ttoken!);
  ok(convs.status === 200 && convs.data.role === "teacher", "강사 이력 role");

  console.log("7) 학생 가입/이력");
  const email = `e2e-${Date.now()}@a.test`;
  const su = await json("POST", "/api/signup", { role: "student", name: "E2E학생", email, password: "e2epass1234" });
  ok(su.status === 200 && su.data.ok, "학생 가입");
  const stoken = await login(email, "e2epass1234");
  ok(!!stoken, "학생 로그인");
  const r3 = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${stoken}` },
    body: JSON.stringify({ teacherId: teacher.id, question: "시산표로 못 잡는 오류가 있나요?" }),
  });
  ok(r3.status === 200 && (await r3.text()).length > 30, "학생 계정 질문");
  const sc = await json("GET", "/api/conversations", undefined, stoken!);
  ok(sc.status === 200 && sc.data.role === "student" && sc.data.conversations.length >= 1, "학생 이력 (본인 대화)");
  const detail = await json("GET", `/api/conversations?id=${sc.data.conversations[0].id}`, undefined, stoken!);
  ok(detail.status === 200 && detail.data.messages.length >= 2, "학생 대화 상세");

  console.log("8) 학원별 강사 가입 흐름");
  const invite = process.env.INVITE_CODE;
  if (!invite) {
    console.log("  - INVITE_CODE 없음 → 스킵");
  } else {
    const temail = `e2e-teacher-${Date.now()}@a.test`;
    const tsu = await json("POST", "/api/signup", {
      email: temail,
      password: "e2epass1234",
      inviteCode: invite,
      academySlug: "e2e-academy",
    });
    ok(tsu.status === 200 && tsu.data.ok, "학원 슬러그로 강사 가입");
    const ntoken = await login(temail, "e2epass1234");
    ok(!!ntoken, "신규 강사 로그인");
    const prof = await json("POST", "/api/profile", { name: "E2E강사", subject: "테스트과목" }, ntoken!);
    ok(prof.status === 200, "프로필 저장 (학원 자동 소속)");
    const byAcademy = await json("GET", "/api/teachers?academy=e2e-academy");
    ok(
      byAcademy.status === 200 &&
        byAcademy.data.teachers.some((x: { name: string }) => x.name === "E2E강사"),
      "학원 한정 강사 목록에 노출"
    );
    const defaultList = await json("GET", "/api/teachers?academy=default");
    ok(
      defaultList.status === 200 &&
        !defaultList.data.teachers.some((x: { name: string }) => x.name === "E2E강사"),
      "기본 학원 목록에는 미노출 (테넌트 격리)"
    );
  }

  console.log("9) 강좌 한정 검색 (급수별 콘텐츠)");
  const cl = await json("GET", `/api/courses?teacher=${teacher.id}`);
  const courseByTitle = (title: string) =>
    cl.data.courses.find((x: { title: string }) => x.title === title);
  const c1 = courseByTitle("전산회계 1급");
  const ct = courseByTitle("전산세무 2급");
  if (!c1 || !ct) {
    console.log("  - 급수 강좌 없음 → scripts/seed-content.ts 먼저 실행. 스킵");
  } else {
    const askIn = async (courseId: string, question: string) => {
      const r = await fetch(`${BASE}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: teacher.id, question, courseId }),
      });
      const src = r.headers.get("x-sources");
      return {
        answer: await r.text(),
        sources: src ? (JSON.parse(decodeURIComponent(src)) as { preview: string }[]) : [],
      };
    };
    const g1 = await askIn(c1.id, "사채 할인발행 시 차금은 어떤 방법으로 상각해?");
    ok(
      g1.sources.some((s) => s.preview.includes("사채")) || /유효이자율법/.test(g1.answer),
      "1급 강좌: 사채 자료 검색·반영"
    );
    const g2 = await askIn(ct.id, "개인 일반과세자 예정고지는 얼마 미만이면 안 나와?");
    ok(
      g2.sources.some((s) => s.preview.includes("부가가치세") || s.preview.includes("예정고지")) ||
        /50만원/.test(g2.answer),
      "세무 2급 강좌: 부가세 자료 검색·반영"
    );
  }

  console.log("10) 테스트 계정 정리");
  // e2e가 만든 계정이 공개 목록/DB에 쌓이지 않게 삭제 (auth cascade로 profiles까지 제거)
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(SB, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  let cleaned = 0;
  for (const u of users?.users ?? []) {
    if (u.email && /^e2e-/.test(u.email)) {
      await admin.auth.admin.deleteUser(u.id);
      cleaned++;
    }
  }
  console.log(`  ✓ e2e-* 계정 ${cleaned}개 삭제`);

  console.log(`\n✅ E2E 전부 통과 (${pass} asserts)`);
}

main().catch((e) => {
  console.error("\n❌", e.message);
  process.exit(1);
});
