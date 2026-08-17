// 전 기능 E2E. 실행 중인 서버(기본 localhost:3000)에 실제 HTTP로 붙어 검증한다.
//
//   npx tsx scripts/e2e.ts                      # 로컬
//   E2E_BASE=https://<도메인> npx tsx scripts/e2e.ts   # 배포본
//
// 전제: scripts/seed.ts + scripts/seed-accounts.ts 실행돼 test/test, st/st 존재.
// 생성한 데이터는 [E2E] 태그를 붙이고 끝에 정리한다.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const db = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0;
let fail = 0;
const failures: string[] = [];
const skipped: string[] = [];

function ok(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name: string, why: string) {
  skipped.push(`${name} (${why})`);
  console.log(`  SKIP  ${name} — ${why}`);
}
function section(t: string) {
  console.log(`\n── ${t}`);
}

async function login(email: string, password: string): Promise<string | null> {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => null);
  return d?.access_token ?? null;
}

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function status(path: string, init?: RequestInit): Promise<number> {
  const r = await fetch(`${BASE}${path}`, init);
  return r.status;
}
async function json(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, init);
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function tableExists(name: string, col: string) {
  const { error } = await db.from(name).select(col).limit(1);
  return !error;
}

async function main() {
  console.log(`E2E → ${BASE}\n`);

  // ── 0. 서버 살아 있는지
  section("서버");
  ok("홈 200", (await status("/")) === 200);

  // ── 1. 인증
  section("인증 (아이디 로그인)");
  const teacherTok = await login("test@ssaem.kr", "test");
  const studentTok = await login("st@ssaem.kr", "st");
  const adminTok = await login("admin@ssaem.kr", "12345678");
  ok("강사 test/test 로그인", Boolean(teacherTok));
  ok("학생 st/st 로그인", Boolean(studentTok));
  ok("원장 로그인", Boolean(adminTok));
  ok("틀린 비밀번호 거부", !(await login("test@ssaem.kr", "wrong-pw")));
  ok("없는 계정 거부", !(await login("nobody@ssaem.kr", "x")));
  if (!teacherTok || !studentTok || !adminTok) {
    console.log("\n토큰 확보 실패 — 이후 검증 불가. seed-accounts 실행 여부 확인 필요");
    process.exit(1);
  }

  // 역할이 서버 기준으로 내려오는지 (클라 라우팅의 근거)
  const prof = await json("/api/profile", { headers: bearer(teacherTok) });
  ok("프로필에 role 포함", prof.body?.profile?.role === "teacher", `role=${prof.body?.profile?.role}`);
  const sprof = await json("/api/profile", { headers: bearer(studentTok) });
  ok("학생 프로필 role=student", sprof.body?.profile?.role === "student");

  // ── 2. 역할 가드
  section("역할 가드 — 학생이 강사 API 접근");
  for (const p of [
    "/api/documents",
    "/api/documents/events",
    "/api/insights",
    "/api/invite",
    "/api/students",
    "/api/courses",
    "/api/quiz/generate",
  ]) {
    ok(`학생 → ${p} 403`, (await status(p, { headers: bearer(studentTok) })) === 403);
  }
  ok(
    "학생 → 강사 승격 차단",
    (await status("/api/profile", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e2e", subject: "x" }),
    })) === 403
  );
  ok("학생 → /api/admin 403", (await status("/api/admin", { headers: bearer(studentTok) })) === 403);
  ok("강사 → /api/admin 403", (await status("/api/admin", { headers: bearer(teacherTok) })) === 403);
  ok("원장 → /api/documents 403", (await status("/api/documents", { headers: bearer(adminTok) })) === 403);
  ok("비인증 → /api/documents 401", (await status("/api/documents")) === 401);

  section("역할 가드 — 정상 경로는 살아 있어야 함");
  for (const p of ["/api/documents", "/api/insights", "/api/invite", "/api/students", "/api/courses"]) {
    ok(`강사 → ${p} 200`, (await status(p, { headers: bearer(teacherTok) })) === 200);
  }
  ok("원장 → /api/admin 200", (await status("/api/admin", { headers: bearer(adminTok) })) === 200);
  ok("학생 → /api/conversations 200", (await status("/api/conversations", { headers: bearer(studentTok) })) === 200);

  // ── 3. 학생 공용 엔드포인트 (전부 로그인 필수)
  section("학생 공용 엔드포인트");
  for (const p of ["/api/teachers", "/api/popular", "/api/quiz?teacher=x"]) {
    ok(`비로그인 → ${p} 401`, (await status(p)) === 401);
  }
  const teachers = await json("/api/teachers", { headers: bearer(studentTok) });
  ok("강사 목록 200", teachers.status === 200 && Array.isArray(teachers.body?.teachers));
  const t0 = teachers.body?.teachers?.[0];
  ok("강사 최소 1명", Boolean(t0), t0 ? `${t0.name} 자료 ${t0.docs}` : "");
  if (!t0) {
    console.log("\n강사가 없어 이후 검증 불가");
    process.exit(1);
  }
  ok(
    "강좌 조회 200",
    (await status(`/api/courses?teacher=${t0.id}`, { headers: bearer(studentTok) })) === 200
  );
  ok("인기 질문 200", (await status("/api/popular", { headers: bearer(studentTok) })) === 200);
  const pop = await json("/api/popular", { headers: bearer(studentTok) });
  ok(
    "인기 질문은 2회 이상만 노출",
    (pop.body?.questions ?? []).every((q: { count: number }) => q.count >= 2)
  );

  // ── 4. 페이지 라우트
  section("페이지 라우트");
  for (const p of [
    "/",
    "/ask",
    "/login",
    "/quiz",
    "/quiz/notes",
    "/my/history",
    "/install",
    "/reset",
    "/pricing",
    "/legal/terms",
    "/legal/privacy",
    "/teacher",
    "/admin",
  ]) {
    ok(`${p} 200`, (await status(p)) === 200);
  }
  ok("없는 문서 404", (await status("/legal/nope")) === 404);

  // ── 5. 질문 → 답변 (스트리밍)
  section("질문·답변");
  const q = "[E2E] 차변과 대변의 차이를 한 줄로 알려주세요";
  const askRes = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: { ...bearer(studentTok), "Content-Type": "application/json" },
    body: JSON.stringify({ teacherId: t0.id, question: q }),
  });
  ok("질문 200", askRes.status === 200, `status=${askRes.status}`);
  ok(
    "비로그인 질문 401",
    (await status("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: t0.id, question: "[E2E] 비로그인" }),
    })) === 401
  );
  const convId = askRes.headers.get("X-Conversation-Id");
  const sourcesHeader = askRes.headers.get("X-Sources");
  const answer = await askRes.text();
  ok("대화 ID 발급", Boolean(convId));
  ok("근거 헤더 존재", Boolean(sourcesHeader));
  const llmDown = /⚠️/.test(answer);
  if (llmDown) skip("답변 본문 생성", `LLM 응답 불가: ${answer.slice(0, 60)}`);
  else ok("답변 본문 생성", answer.trim().length > 20, `${answer.length}자`);

  // 소유권: 남의 대화 id로 주입 시도 → 새 대화로 분리돼야 함
  if (convId) {
    // 이력 기록은 스트림 종료 "후" 비동기라 메시지 개수로 판정하면 흔들린다.
    // 주입하려던 문구가 그 대화에 실제로 들어갔는지로 본다 — 타이밍과 무관.
    const MARK = "[E2E] 주입 시도 " + Date.now();
    // 비인증은 이제 401이라 아예 못 들어온다. 남의 계정(강사 토큰)으로 주입을 시도한다.
    const inject = await fetch(`${BASE}/api/ask`, {
      method: "POST",
      headers: { ...bearer(teacherTok), "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: t0.id, question: MARK, conversationId: convId }),
    });
    const injectedConv = inject.headers.get("X-Conversation-Id");
    await inject.text();
    await new Promise((r) => setTimeout(r, 4000));

    const { count: leaked } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convId)
      .eq("content", MARK);

    ok("주입 시도는 새 대화로 분리", Boolean(injectedConv) && injectedConv !== convId);
    ok("남의 대화에 주입 문구 없음", (leaked ?? 0) === 0, `유입 ${leaked}건`);
    if (injectedConv && injectedConv !== convId)
      await db.from("conversations").delete().eq("id", injectedConv);
  }

  // 피드백 소유권
  if (convId) {
    ok(
      "비로그인 피드백 401",
      (await status("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, rating: 1 }),
      })) === 401
    );
    ok(
      "남의 대화 피드백 403",
      (await status("/api/feedback", {
        method: "POST",
        headers: { ...bearer(teacherTok), "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, rating: 1 }),
      })) === 403
    );
    ok(
      "본인 피드백 허용",
      (await status("/api/feedback", {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, rating: 5 }),
      })) === 200
    );
  }

  // ── 6. 대화내역
  section("대화내역");
  const convs = await json("/api/conversations", { headers: bearer(studentTok) });
  ok("학생 이력 조회", convs.status === 200 && Array.isArray(convs.body?.conversations));
  ok("role=student 반환", convs.body?.role === "student");
  const mine = (convs.body?.conversations ?? []).find((c: { id: string }) => c.id === convId);
  ok("방금 대화가 이력에 있음", Boolean(mine));
  if (convId) {
    const detail = await json(`/api/conversations?id=${convId}`, { headers: bearer(studentTok) });
    ok("대화 상세 조회", detail.status === 200 && (detail.body?.messages?.length ?? 0) >= 2);
    // 남의 대화 열람 차단
    ok(
      "강사는 남의 학생 대화도 당사자면 조회 가능",
      (await status(`/api/conversations?id=${convId}`, { headers: bearer(teacherTok) })) === 200
    );
  }

  // ── 7. 문제풀이 / 오답노트
  section("문제풀이·오답노트");
  const hasQuiz = (await tableExists("quiz_questions", "question")) && (await tableExists("quiz_attempts", "chosen"));
  if (!hasQuiz) {
    skip("퀴즈 전 구간", "quiz_questions/quiz_attempts 테이블 없음 — 마이그레이션 미실행");
  } else {
    const list = await json(`/api/quiz?teacher=${t0.id}`, { headers: bearer(studentTok) });
    ok("문제 목록 200", list.status === 200);
    const first = list.body?.questions?.[0];
    ok(
      "출제 응답에 정답 미포함",
      !first || (!("answer" in first) && !("explanation" in first)),
      first ? Object.keys(first).join(",") : "문제 없음"
    );
    // 공부 모드는 정답·해설을 함께 준다
    const studyList = await json(`/api/quiz?teacher=${t0.id}&study=1`, { headers: bearer(studentTok) });
    const studyFirst = studyList.body?.questions?.[0];
    if (studyFirst)
      ok(
        "공부 모드 응답에 정답·해설 포함",
        "answer" in studyFirst && "explanation" in studyFirst,
        Object.keys(studyFirst).join(",")
      );
    if (first) {
      const graded = await json("/api/quiz/attempt", {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: first.id, chosen: 0 }),
      });
      ok("채점 200", graded.status === 200);
      ok("채점 결과에 정답·해설 포함", typeof graded.body?.correct === "boolean" && "answer" in (graded.body ?? {}));
      ok("로그인 학생 기록 저장", graded.body?.saved === true);
      const notes = await json("/api/quiz/attempt", { headers: bearer(studentTok) });
      ok("오답노트 조회 200", notes.status === 200 && typeof notes.body?.totals?.attempted === "number");
    } else {
      skip("채점·오답노트", "생성된 문제가 없음 (강사가 '문제 만들기' 미실행)");
    }
    ok(
      "문제 목록에 teacher 필수",
      (await status("/api/quiz", { headers: bearer(studentTok) })) === 400
    );
  }

  // ── 7.3 문제은행 (기출)
  section("문제은행");
  const hasBank = await tableExists("bank_questions", "stem");
  if (!hasBank) {
    skip("문제은행 전 구간", "bank_questions 테이블 없음 — 마이그레이션·import 미실행");
  } else {
    const tree = await json("/api/bank", { headers: bearer(studentTok) });
    ok("필터 트리 200", tree.status === 200 && Array.isArray(tree.body?.tree));
    const subj = (tree.body?.tree ?? [])[0]?.subject;
    ok("트리에 과목 있음", Boolean(subj), subj ?? "비어 있음");
    if (subj) {
      const set = await json(`/api/bank?subject=${encodeURIComponent(subj)}&limit=5`, {
        headers: bearer(studentTok),
      });
      ok("문제 세트 200", set.status === 200);
      const items = set.body?.questions ?? [];
      ok("문제 반환됨", items.length > 0, `${items.length}문항`);
      const theory = items.find((q: { type: string }) => q.type === "theory");
      const practice = items.find((q: { type: string }) => q.type === "practice");
      // 이론은 정답 미포함
      ok(
        "이론 정답 미포함",
        !theory || (!("answer_idx" in theory) && !("explanation" in theory)),
        theory ? Object.keys(theory).join(",") : "이론 없음"
      );
      // 공부 모드는 이론도 정답(answerIdx)·해설 포함
      const studySet = await json(`/api/bank?subject=${encodeURIComponent(subj)}&limit=10&study=1`, {
        headers: bearer(studentTok),
      });
      const studyTheory = (studySet.body?.questions ?? []).find((q: { type: string }) => q.type === "theory");
      if (studyTheory)
        ok(
          "공부 모드 이론에 정답·해설 포함",
          "answerIdx" in studyTheory && "explanation" in studyTheory,
          Object.keys(studyTheory).join(",")
        );
      // 실무는 자가채점이라 answer_text 포함
      ok("실무 answer_text 포함", !practice || "answerText" in practice, practice ? "ok" : "실무 없음");

      if (theory) {
        const graded = await json("/api/bank/attempt", {
          method: "POST",
          headers: { ...bearer(studentTok), "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: theory.id, chosen: 0 }),
        });
        ok("이론 채점 200", graded.status === 200);
        ok(
          "채점 응답에 정답·해설",
          typeof graded.body?.correct === "boolean" && "answer_idx" in (graded.body ?? {}),
          Object.keys(graded.body ?? {}).join(",")
        );
        ok("이론 기록 저장", graded.body?.saved === true);
      }
      if (practice) {
        const self = await json("/api/bank/attempt", {
          method: "POST",
          headers: { ...bearer(studentTok), "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: practice.id, correct: false }),
        });
        ok("실무 자가채점 200", self.status === 200 && self.body?.saved === true);
      }
      const notes = await json("/api/bank/attempt", { headers: bearer(studentTok) });
      ok("오답노트 200", notes.status === 200 && typeof notes.body?.totals?.attempted === "number");
    }
  }

  // ── 7.5 학생 가입 초대코드
  section("학생 가입 초대코드");
  {
    const inv = await json("/api/invite", { headers: bearer(teacherTok) });
    const code = (inv.body?.url ?? "").split("/join/")[1] ?? "";
    ok("강사 초대 코드 발급", Boolean(code));

    ok(
      "잘못된 초대코드 가입 거부",
      (await status("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "student",
          email: `e2einv${Date.now()}`,
          password: "12345678",
          name: "[E2E]초대",
          studentInviteCode: "nope-not-a-code",
        }),
      })) === 403
    );

    if (code) {
      const sid = `e2einv${Date.now()}`;
      const made = await json("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "student",
          email: sid,
          password: "12345678",
          name: "[E2E]초대학생",
          studentInviteCode: code,
        }),
      });
      ok("초대코드 가입 200", made.status === 200, `status=${made.status}`);
      const newUid = made.body?.userId;
      if (newUid) {
        // 초대한 강사의 학원으로 소속되고, 그 강사 반에 수강 연결됐는지
        const { data: prof } = await db
          .from("profiles")
          .select("academy_id, role")
          .eq("id", newUid)
          .maybeSingle();
        const { data: teacherProf } = await db
          .from("profiles")
          .select("academy_id")
          .eq("id", t0.id)
          .maybeSingle();
        ok("학생 role 저장", prof?.role === "student");
        ok(
          "초대한 강사의 학원으로 소속",
          Boolean(prof?.academy_id) && prof?.academy_id === teacherProf?.academy_id
        );
        const { count } = await db
          .from("enrollments")
          .select("student_id", { count: "exact", head: true })
          .eq("student_id", newUid);
        ok("수강 연결 생성", (count ?? 0) > 0, `${count}건`);
        await db.from("enrollments").delete().eq("student_id", newUid);
        await db.from("profiles").delete().eq("id", newUid);
        await db.auth.admin.deleteUser(newUid);
      }
    }
  }

  // ── 8. 요금제 문의
  section("요금제 문의");
  const hasInq = await tableExists("plan_inquiries", "contact");
  if (!hasInq) skip("도입 문의 접수", "plan_inquiries 테이블 없음");
  else {
    const r = await json("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "[E2E]", contact: "e2e@test" }),
    });
    ok("문의 접수 200", r.status === 200);
    await db.from("plan_inquiries").delete().eq("name", "[E2E]");
  }
  ok(
    "문의 필수값 검증",
    (await status("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    })) === 400
  );

  // ── 9. PWA
  section("PWA");
  const man = await json("/manifest.webmanifest");
  ok("매니페스트 200", man.status === 200 && man.body?.start_url === "/");
  ok("아이콘 192 PNG", (await status("/pwa-icon/192")) === 200);
  ok("아이콘 512 PNG", (await status("/pwa-icon/512")) === 200);
  ok("애플 아이콘", (await status("/apple-icon")) === 200);

  // ── 정리
  section("정리");
  const { data: junk } = await db.from("conversations").select("id").like("title", "[E2E]%");
  if (junk?.length) {
    await db.from("conversations").delete().in("id", junk.map((c) => c.id));
    console.log(`  E2E 대화 ${junk.length}건 삭제`);
  }

  // ── 결과
  console.log(`\n${"=".repeat(50)}`);
  console.log(`통과 ${pass} · 실패 ${fail} · 건너뜀 ${skipped.length}`);
  if (skipped.length) console.log(`건너뜀:\n${skipped.map((s) => `  - ${s}`).join("\n")}`);
  if (failures.length) {
    console.log(`실패:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
