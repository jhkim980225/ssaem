// 클라이언트가 anon key로 PostgREST를 직접 때렸을 때 무엇이 뚫리는지 검사.
// 앱 API 가드(scripts/matrix.ts)는 이 경로를 전혀 보지 못한다 — 요청이 Next를 안 거친다.
// 실행: npx tsx scripts/rls-check.ts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

async function rest(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const body = await r.text();
  return { status: r.status, body };
}

async function login(email: string, pw: string) {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data } = await sb.auth.signInWithPassword({ email, password: pw });
  return { token: data.session?.access_token ?? "", uid: data.user?.id ?? "" };
}

// 읽기가 "비었으면 통과". 정책이 없으면 PostgREST는 200 + [] 를 준다 (403이 아니다).
const empty = (b: string) => b.trim() === "[]";

async function main() {
  const st = await login("st@ssaem.kr", "st");
  if (!st.token) {
    console.log("학생 계정 로그인 실패 — seed-accounts 필요");
    process.exit(1);
  }
  console.log(`\n학생 토큰 확보 (uid ${st.uid.slice(0, 8)}…)\n`);
  console.log("── anon key 직접 접근 (전부 차단돼야 함)");

  // 1) 자가 권한 상승 — 가장 위험. 현재 role을 그대로 다시 써서 데이터는 안 바꾼다.
  const cur = await rest(`profiles?id=eq.${st.uid}&select=role`, st.token);
  const curRole = (JSON.parse(cur.body || "[]")[0]?.role as string) ?? "student";
  const esc = await rest(`profiles?id=eq.${st.uid}`, st.token, {
    method: "PATCH",
    body: JSON.stringify({ role: curRole }),
  });
  ok(
    "profiles.role 자가 수정 차단",
    esc.status === 403 || empty(esc.body),
    `status=${esc.status} body=${esc.body.slice(0, 60)}`
  );

  // 2) 퀴즈 정답 유출 — 서버는 정답을 일부러 빼고 내려보낸다
  const quiz = await rest("quiz_questions?select=id,answer,explanation&limit=3", st.token);
  ok("퀴즈 정답·해설 열람 차단", empty(quiz.body), `${quiz.body.slice(0, 60)}`);

  // 3) 학원 구성원 명단 (실명·uuid·역할)
  const people = await rest("profiles?select=id,name,role&limit=5", st.token);
  ok("학원 구성원 명단 덤프 차단", empty(people.body), `${people.body.slice(0, 60)}`);

  // 4) 남의 대화·메시지 원문
  const msgs = await rest("messages?select=content&limit=3", st.token);
  ok("메시지 원문 열람 차단", empty(msgs.body), `${msgs.body.slice(0, 60)}`);

  // 5) 강사 자료 원문
  const docs = await rest("documents?select=raw_text&limit=1", st.token);
  ok("자료 원문 열람 차단", empty(docs.body), `${docs.body.slice(0, 60)}`);

  // 6) 채점 기록 위조 (INSERT) — 성공하면 오답노트·강사 리포트가 오염된다
  const forge = await rest("quiz_attempts", st.token, {
    method: "POST",
    body: JSON.stringify({
      question_id: "00000000-0000-0000-0000-000000000000",
      student_id: st.uid,
      chosen: 0,
      correct: true,
    }),
  });
  ok("채점 기록 위조 차단", forge.status >= 400, `status=${forge.status}`);

  console.log("\n" + "=".repeat(50));
  console.log(`통과 ${pass} · 실패 ${fails.length}`);
  if (fails.length) {
    console.log("\n뚫린 항목:");
    for (const f of fails) console.log("  - " + f);
    console.log("\n→ supabase/migrations/20260810000000_lock_client_rls.sql 을 실행할 것");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
