// 학원(테넌트) 경계 검증.
//
// 역할 가드(scripts/matrix.ts)는 "학생이냐 강사냐"만 본다. 그래서 로그인한 학생이
// **남의 학원** 강사 uuid를 넣어 호출하는 계열은 162케이스에 안 걸렸다.
// 이 스크립트는 실제로 학원 2개를 만들어, A학원 학생이 B학원 데이터를 볼 수 있는지 본다.
//
// 실행: npx tsx scripts/tenant-check.ts   (서버 실행 중이어야 함)
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, note = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } else {
    fails.push(`${name}${note ? ` — ${note}` : ""}`);
    console.log(`  FAIL  ${name}${note ? ` — ${note}` : ""}`);
  }
}
const section = (t: string) => console.log(`\n── ${t}`);

const TAG = "[TENANT]";
const made: { users: string[]; academies: string[]; courses: string[]; questions: string[] } = {
  users: [],
  academies: [],
  courses: [],
  questions: [],
};

async function mkUser(email: string, password: string) {
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  made.users.push(data.user.id);
  return data.user.id;
}

async function login(email: string, password: string) {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`login ${email}: ${error?.message}`);
  return data.session.access_token;
}

const api = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers as object) },
  });

async function main() {
  const stamp = Date.now();
  section("두 학원 준비 (A: 우리, B: 남의 학원)");

  // 학원 2개
  const acs: string[] = [];
  for (const n of ["A", "B"]) {
    const { data, error } = await db
      .from("academies")
      .insert({ name: `${TAG}${n}`, slug: `tenant-${n.toLowerCase()}-${stamp}` })
      .select("id")
      .single();
    if (error) throw new Error(`academy ${n}: ${error.message}`);
    made.academies.push(data.id);
    acs.push(data.id);
  }
  const [acA, acB] = acs;

  // A: 학생 1, B: 강사 1 (+문제, +강좌, +대화)
  const stuAId = await mkUser(`tenant-stu-a-${stamp}@ssaem.kr`, "12345678");
  await db.from("profiles").insert({ id: stuAId, academy_id: acA, role: "student", name: `${TAG}학생A` });

  const tchBId = await mkUser(`tenant-tch-b-${stamp}@ssaem.kr`, "12345678");
  await db.from("profiles").insert({ id: tchBId, academy_id: acB, role: "teacher", name: `${TAG}강사B` });
  await db.from("teacher_profiles").insert({ id: tchBId, subject: `${TAG}과목`, is_public: true });

  const { data: courseB } = await db
    .from("courses")
    .insert({ academy_id: acB, teacher_id: tchBId, title: `${TAG}B강좌` })
    .select("id")
    .single();
  if (courseB) made.courses.push(courseB.id);

  const { data: qB } = await db
    .from("quiz_questions")
    .insert({
      teacher_id: tchBId,
      question: `${TAG} B학원 전용 문제`,
      choices: ["가", "나", "다", "라"],
      answer: 2,
      explanation: `${TAG} B학원 해설 — 새면 안 됨`,
    })
    .select("id")
    .single();
  if (qB) made.questions.push(qB.id);

  // B학원 학생이 남긴 질문 2건 (popular은 2회 이상 반복만 노출)
  const stuBId = await mkUser(`tenant-stu-b-${stamp}@ssaem.kr`, "12345678");
  await db.from("profiles").insert({ id: stuBId, academy_id: acB, role: "student", name: `${TAG}학생B` });
  const { data: convB } = await db
    .from("conversations")
    .insert({ teacher_id: tchBId, student_id: stuBId, title: `${TAG}B대화` })
    .select("id")
    .single();
  if (convB)
    await db.from("messages").insert([
      { conversation_id: convB.id, role: "user", content: `${TAG} B학원 학생의 비밀 질문입니다 감가상각` },
      { conversation_id: convB.id, role: "user", content: `${TAG} B학원 학생의 비밀 질문입니다 감가상각` },
    ]);

  ok("A학원 학생 · B학원 강사 준비", Boolean(stuAId && tchBId && qB));
  const tok = await login(`tenant-stu-a-${stamp}@ssaem.kr`, "12345678");

  section("A학원 학생이 B학원 데이터에 접근 시도 (전부 차단돼야 함)");

  // 1. 강사 목록에 남의 학원 강사가 섞이나
  const tl = await (await api("/api/teachers", tok)).json();
  const names: string[] = (tl.teachers ?? []).map((t: { name: string }) => t.name);
  ok("강사 목록에 타 학원 강사 없음", !names.includes(`${TAG}강사B`), `${names.length}명`);

  // 2. 남의 학원 slug로 목록 조회
  const { data: acBRow } = await db.from("academies").select("slug").eq("id", acB).single();
  const tl2 = await (await api(`/api/teachers?academy=${acBRow!.slug}`, tok)).json();
  ok("타 학원 slug로도 목록 안 보임", (tl2.teachers ?? []).length === 0, `${(tl2.teachers ?? []).length}명`);

  // 3. 인기 질문에 남의 학원 질문 원문이 섞이나
  const pop = await (await api("/api/popular", tok)).json();
  const popText = JSON.stringify(pop);
  ok("인기 질문에 타 학원 질문 원문 없음", !popText.includes("B학원 학생의 비밀 질문"));
  ok("인기 질문 byTeacher에 타 학원 강사 없음", !popText.includes("강사B"));

  // 4. teacher 파라미터로 직접 지목
  const pop2 = await (await api(`/api/popular?teacher=${tchBId}`, tok)).json();
  ok(
    "타 학원 강사 지목 인기 질문 차단",
    !JSON.stringify(pop2).includes("B학원 학생의 비밀 질문")
  );

  // 5. 유사 질문 추천
  const rel = await (await api(`/api/related?teacher=${tchBId}&q=${encodeURIComponent("감가상각")}`, tok)).json();
  ok("타 학원 유사 질문 추천 차단", (rel.related ?? []).length === 0, `${(rel.related ?? []).length}건`);

  // 6. 남의 학원 문제 목록
  const qz = await api(`/api/quiz?teacher=${tchBId}`, tok);
  const qzBody = await qz.json();
  ok(
    "타 학원 문제 목록 차단",
    qz.status === 404 || (qzBody.questions ?? []).length === 0,
    `status=${qz.status} 문항=${(qzBody.questions ?? []).length}`
  );

  // 7. 남의 학원 문제 채점 (정답·해설이 새는 핵심 경로)
  const at = await api("/api/quiz/attempt", tok, {
    method: "POST",
    body: JSON.stringify({ questionId: qB!.id, chosen: 0 }),
  });
  const atBody = await at.json();
  ok(
    "타 학원 문제 채점 차단 (정답·해설 미노출)",
    at.status === 404 && !("answer" in atBody),
    `status=${at.status} keys=${Object.keys(atBody).join(",")}`
  );

  // 8. 남의 학원 강좌 목록
  const co = await (await api(`/api/courses?teacher=${tchBId}`, tok)).json();
  ok("타 학원 강좌 목록 차단", (co.courses ?? []).length === 0, `${(co.courses ?? []).length}건`);

  section("같은 학원 안에서는 정상 동작해야 한다 (과잉 차단 방지)");
  const tchAId = await mkUser(`tenant-tch-a-${stamp}@ssaem.kr`, "12345678");
  await db.from("profiles").insert({ id: tchAId, academy_id: acA, role: "teacher", name: `${TAG}강사A` });
  await db.from("teacher_profiles").insert({ id: tchAId, subject: `${TAG}과목A`, is_public: true });
  const { data: qA } = await db
    .from("quiz_questions")
    .insert({
      teacher_id: tchAId,
      question: `${TAG} A학원 문제`,
      choices: ["가", "나", "다", "라"],
      answer: 1,
      explanation: `${TAG} A해설`,
    })
    .select("id")
    .single();
  if (qA) made.questions.push(qA.id);

  const tl3 = await (await api("/api/teachers", tok)).json();
  ok(
    "같은 학원 강사는 목록에 보임",
    (tl3.teachers ?? []).some((t: { name: string }) => t.name === `${TAG}강사A`)
  );

  const qz2 = await (await api(`/api/quiz?teacher=${tchAId}`, tok)).json();
  ok("같은 학원 문제 목록 조회 200", (qz2.questions ?? []).length > 0, `${(qz2.questions ?? []).length}문항`);

  const at2 = await api("/api/quiz/attempt", tok, {
    method: "POST",
    body: JSON.stringify({ questionId: qA!.id, chosen: 1 }),
  });
  const at2Body = await at2.json();
  ok("같은 학원 채점 정상 (정답·해설 반환)", at2.status === 200 && at2Body.correct === true, `status=${at2.status}`);

  console.log("\n" + "=".repeat(50));
  console.log(`통과 ${pass} · 실패 ${fails.length}`);
  if (fails.length) {
    console.log("실패:");
    for (const f of fails) console.log("  - " + f);
  }
  return fails.length;
}

async function cleanup() {
  await db.from("quiz_attempts").delete().in("question_id", made.questions);
  await db.from("quiz_questions").delete().in("id", made.questions);
  await db.from("courses").delete().in("id", made.courses);
  for (const u of made.users) {
    await db.from("messages").delete().in(
      "conversation_id",
      ((await db.from("conversations").select("id").eq("student_id", u)).data ?? []).map((c) => c.id)
    );
    await db.from("conversations").delete().eq("student_id", u);
    await db.from("conversations").delete().eq("teacher_id", u);
    await db.from("enrollments").delete().eq("student_id", u);
    await db.from("teacher_profiles").delete().eq("id", u);
    await db.from("profiles").delete().eq("id", u);
    await db.auth.admin.deleteUser(u);
  }
  await db.from("academies").delete().in("id", made.academies);
  console.log("정리 완료");
}

main()
  .then(async (n) => {
    await cleanup();
    process.exit(n ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("FAIL:", e.message);
    await cleanup().catch(() => {});
    process.exit(1);
  });
