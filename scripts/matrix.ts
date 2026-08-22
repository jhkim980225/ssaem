// 역할 × 라우트 전 조합 검증. e2e.ts가 "정상 경로"를 보는 반면 여기는 **교차 접근 전수**를 본다.
// 실행: npx tsx scripts/matrix.ts   (서버 실행 중이어야 함)
//       E2E_BASE=https://<도메인> npx tsx scripts/matrix.ts
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { roleFitsTab, homeFor, type Role } from "../src/lib/role";

config({ path: ".env.local" });
const BASE = process.env.E2E_BASE ?? "http://localhost:3000";

let pass = 0;
let skipped = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, note = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } else {
    fails.push(name + (note ? ` — ${note}` : ""));
    console.log(`  FAIL  ${name}${note ? ` — ${note}` : ""}`);
  }
}
const section = (t: string) => console.log(`\n── ${t}`);

// ── 1. 탭 × 역할 판정 (순수 함수 — /login 클라이언트가 쓰는 그 로직)
function tabMatrix() {
  section("로그인 탭 × 계정 역할");
  const cases: [("student" | "teacher"), Role, boolean][] = [
    ["student", "student", true],
    ["student", "teacher", false],
    ["student", "admin", false],
    ["student", null, false],
    ["teacher", "teacher", true],
    ["teacher", null, true], // 가입 직후 프로필 저장 전 — 막으면 프로필을 못 만든다
    ["teacher", "student", false],
    ["teacher", "admin", false],
  ];
  for (const [tab, role, want] of cases)
    ok(`${tab} 탭 × role=${role ?? "null"} → ${want ? "통과" : "거부"}`, roleFitsTab(tab, role) === want);

  // 착지는 언제나 서버 role 기준 (탭과 무관)
  ok("착지 admin → /admin", homeFor("admin") === "/admin");
  ok("착지 student → /ask", homeFor("student") === "/ask");
  ok("착지 teacher → /teacher", homeFor("teacher") === "/teacher");
  ok("착지 null → /teacher", homeFor(null) === "/teacher");
}

// ── 2. API 전수 교차 접근
type Who = "anon" | "student" | "teacher" | "admin";

// 기대 상태: 200이면 허용, 401/403이면 거부. 400은 "인증은 통과하고 입력 검증에 걸림" = 허용으로 본다.
const ALLOW = "allow";
const DENY = "deny";

type Case = {
  path: string;
  method?: string;
  body?: unknown;
  expect: Record<Who, typeof ALLOW | typeof DENY>;
};

const M = (a: typeof ALLOW | typeof DENY, s: typeof ALLOW | typeof DENY, t: typeof ALLOW | typeof DENY, ad: typeof ALLOW | typeof DENY) =>
  ({ anon: a, student: s, teacher: t, admin: ad }) as Record<Who, typeof ALLOW | typeof DENY>;

function buildCases(teacherId: string): Case[] {
  return [
    // 공개
    { path: "/api/inquiry", method: "POST", body: {}, expect: M(ALLOW, ALLOW, ALLOW, ALLOW) },
    { path: "/api/join?code=x", expect: M(ALLOW, ALLOW, ALLOW, ALLOW) },
    { path: "/api/join-teacher?code=x", expect: M(ALLOW, ALLOW, ALLOW, ALLOW) },

    // 로그인만 — 역할 무관 허용, 익명만 거부
    { path: "/api/ask", method: "POST", body: {}, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/teachers", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: `/api/courses?teacher=${teacherId}`, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: `/api/lessons?teacher=${teacherId}`, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/popular", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/related?teacher=x&q=abcd", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/quiz?teacher=" + teacherId, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/quiz?mode=wrong", expect: M(DENY, ALLOW, ALLOW, ALLOW) }, // 전체 오답 모드 (teacher 생략)
    { path: "/api/visit", expect: M(DENY, ALLOW, DENY, DENY) }, // 출석 요약 — 학생 전용
    { path: "/api/visit", method: "POST", expect: M(DENY, ALLOW, ALLOW, ALLOW) }, // 핑은 로그인만 (비학생은 no-op)
    { path: "/api/quiz/attempt", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/quiz/attempt", method: "POST", body: {}, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/feedback", method: "POST", body: {}, expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/profile", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/conversations", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/usage", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    // 문제은행 — 전역 공용, 로그인 전원 (학원 경계 없음)
    { path: "/api/bank", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/bank/attempt", expect: M(DENY, ALLOW, ALLOW, ALLOW) },
    { path: "/api/bank/attempt", method: "POST", body: {}, expect: M(DENY, ALLOW, ALLOW, ALLOW) },

    // 강사 전용 — 학생·원장·익명 전부 거부
    { path: "/api/documents", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/documents", method: "POST", body: {}, expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/documents", method: "PATCH", body: {}, expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/documents?id=x", method: "DELETE", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/documents/events", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/upload", method: "POST", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/courses", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/courses", method: "POST", body: {}, expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/courses?id=x", method: "DELETE", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/insights", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/students", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/students/reset-password", method: "POST", body: {}, expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/invite", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/quiz/generate", expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/quiz/generate", method: "POST", body: {}, expect: M(DENY, DENY, ALLOW, DENY) },
    { path: "/api/quiz/generate?id=x", method: "DELETE", expect: M(DENY, DENY, ALLOW, DENY) },

    // 원장 전용
    { path: "/api/admin", expect: M(DENY, DENY, DENY, ALLOW) },
    { path: "/api/admin", method: "PATCH", body: {}, expect: M(DENY, DENY, DENY, ALLOW) },
  ];
}

async function login(email: string, pw: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { data } = await sb.auth.signInWithPassword({ email, password: pw });
  return data.session?.access_token ?? null;
}

async function main() {
  tabMatrix();

  const tok: Record<Who, string | null> = {
    anon: null,
    student: await login("st@ssaem.kr", "st"),
    teacher: await login("test@ssaem.kr", "test"),
    admin: await login("admin@ssaem.kr", "12345678"),
  };
  section("계정 준비");
  for (const w of ["student", "teacher", "admin"] as const) ok(`${w} 토큰 확보`, Boolean(tok[w]));
  if (!tok.student || !tok.teacher || !tok.admin) {
    console.log("\n계정이 없어 중단. scripts/seed-accounts.ts 실행 필요");
    process.exit(1);
  }

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: t0 } = await db.from("profiles").select("id").eq("role", "teacher").limit(1).maybeSingle();

  section("API 교차 접근 (역할 × 라우트)");
  const cases = buildCases(t0?.id ?? "00000000-0000-0000-0000-000000000000");
  for (const c of cases) {
    for (const who of ["anon", "student", "teacher", "admin"] as const) {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (tok[who]) headers.Authorization = `Bearer ${tok[who]}`;
      const res = await fetch(`${BASE}${c.path}`, {
        method: c.method ?? "GET",
        headers,
        body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
      }).catch(() => null);
      const st = res?.status ?? 0;
      await res?.text();

      const denied = st === 401 || st === 403;
      const want = c.expect[who];
      // 429(rate limit)는 판정 불가 — 거부/허용 어느 쪽으로도 세지 않는다
      if (st === 429) {
        skipped++;
        console.log(`  SKIP  ${who} ${c.method ?? "GET"} ${c.path} — 429 rate limit`);
        continue;
      }
      ok(
        `${who} ${c.method ?? "GET"} ${c.path} → ${want}`,
        want === DENY ? denied : !denied,
        `status=${st}`
      );
    }
  }

  section("페이지 라우트 (전 역할 200 — 가드는 클라이언트)");
  for (const p of [
    "/", "/login", "/reset", "/install", "/pricing", "/legal/terms", "/legal/privacy",
    "/ask", "/quiz", "/quiz/notes", "/my", "/my/history", "/my/records", "/bank", "/bank/notes",
    "/teacher", "/teacher/insights", "/teacher/history", "/teacher/students", "/admin",
  ]) {
    const r = await fetch(`${BASE}${p}`).catch(() => null);
    await r?.text();
    ok(`${p} 200`, r?.status === 200, `status=${r?.status}`);
  }

  console.log("\n" + "=".repeat(50));
  // 건너뜀을 요약에 드러낸다 — 안 그러면 rate limit에 걸린 만큼 커버리지가 조용히 줄어든다
  console.log(`통과 ${pass} · 실패 ${fails.length} · 건너뜀 ${skipped}`);
  if (skipped)
    console.log("  (건너뜀 = 429. 앞선 호출로 한도를 쓴 것 — 서버 재시작 후 재실행하면 0)");
  if (fails.length) {
    console.log("실패:");
    for (const f of fails) console.log("  - " + f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
