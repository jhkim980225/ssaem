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

  section("강좌 CRUD — 생성·이름 변경·삭제");
  const jsonHdr = { ...bearer(teacherTok), "Content-Type": "application/json" };
  const cRes = await json("/api/courses", {
    method: "POST",
    headers: jsonHdr,
    body: JSON.stringify({ title: "[E2E] 강좌" }),
  });
  ok("강좌 생성", Boolean(cRes.body?.id));
  if (cRes.body?.id) {
    const cid = cRes.body.id as string;
    ok(
      "강좌 이름 변경 200",
      (await status("/api/courses", {
        method: "PATCH",
        headers: jsonHdr,
        body: JSON.stringify({ id: cid, title: "[E2E] 강좌 개명" }),
      })) === 200
    );
    const list = await json("/api/courses", { headers: bearer(teacherTok) });
    ok(
      "바뀐 이름이 목록에 반영",
      ((list.body?.courses ?? []) as { id: string; title: string }[]).some(
        (c) => c.id === cid && c.title === "[E2E] 강좌 개명"
      )
    );
    ok(
      "학생 → 강좌 이름 변경 403",
      (await status("/api/courses", {
        method: "PATCH",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ id: cid, title: "x" }),
      })) === 403
    );
    ok(
      "빈 이름 400",
      (await status("/api/courses", {
        method: "PATCH",
        headers: jsonHdr,
        body: JSON.stringify({ id: cid, title: "  " }),
      })) === 400
    );

    // ROOM 초대: 강좌 코드 발급 → 학생 등록 → 그 강좌 수강 연결 (여러 ROOM 등록의 기반)
    const inv = await json(`/api/invite?course=${cid}`, { headers: bearer(teacherTok) });
    ok("ROOM 초대 코드 발급 (c.)", Boolean(inv.body?.code?.startsWith("c.")));
    if (inv.body?.code) {
      const pv = await json(`/api/join?code=${encodeURIComponent(inv.body.code)}`);
      ok("초대 미리보기에 ROOM 표시", pv.body?.course?.id === cid);
      const jr = await json("/api/join", {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ code: inv.body.code }),
      });
      ok("학생 ROOM 코드 등록", jr.status === 200 && jr.body?.courseId === cid);
      const stUid = JSON.parse(Buffer.from(studentTok.split(".")[1], "base64").toString()).sub as string;
      const { data: enr } = await db
        .from("enrollments")
        .select("course_id")
        .eq("course_id", cid)
        .eq("student_id", stUid);
      ok("enrollments에 그 ROOM 수강 연결", (enr ?? []).length === 1);
      ok(
        "학생 → 강좌 초대코드 발급 403",
        (await status(`/api/invite?course=${cid}`, { headers: bearer(studentTok) })) === 403
      );

      // 학생 강좌 목록 = 수강 연결된 ROOM만 (v0.40.1) — 초대 안 받은 강좌는 안 보인다
      const tUid = JSON.parse(Buffer.from(teacherTok.split(".")[1], "base64").toString()).sub as string;
      const scl = await json(`/api/courses?teacher=${tUid}`, { headers: bearer(studentTok) });
      const sclIds = ((scl.body?.courses ?? []) as { id: string }[]).map((c) => c.id);
      const { data: myEnr } = await db
        .from("enrollments")
        .select("course_id, courses!inner(teacher_id)")
        .eq("student_id", stUid)
        .eq("courses.teacher_id", tUid);
      const myIds = new Set(((myEnr ?? []) as { course_id: string }[]).map((e) => e.course_id));
      ok(
        "학생 강좌 목록 — 초대받은 ROOM 포함 + 그 외 없음",
        scl.status === 200 && sclIds.includes(cid) && sclIds.every((id) => myIds.has(id)),
        `${sclIds.length}개 (수강 ${myIds.size}개)`
      );
      const tcl = await json(`/api/courses?teacher=${tUid}`, { headers: bearer(teacherTok) });
      ok(
        "강사는 자기 강좌 전체 보임",
        tcl.status === 200 && ((tcl.body?.courses ?? []) as { id: string }[]).some((c) => c.id === cid)
      );
    }
    ok(
      "강좌 삭제 200",
      (await status(`/api/courses?id=${cid}`, { method: "DELETE", headers: bearer(teacherTok) })) === 200
    );
  }

  section("수업 달력 — lesson_date 저장·조회");
  // 테스트 강사는 무료 한도(10건)를 이미 넘겨서 등록이 403 — 잠시 pro로 올렸다가 끝나면 원복
  const tUid = JSON.parse(Buffer.from(teacherTok.split(".")[1], "base64").toString()).sub as string;
  const { data: tProf } = await db.from("profiles").select("academy_id").eq("id", tUid).maybeSingle();
  const acadId = tProf?.academy_id ?? null;
  let prevPlan: string | null = null;
  if (acadId) {
    const { data: a } = await db.from("academies").select("plan").eq("id", acadId).maybeSingle();
    prevPlan = a?.plan ?? "free";
    await db.from("academies").update({ plan: "pro" }).eq("id", acadId);
  }
  try {
  const ld = await json("/api/documents", {
    method: "POST",
    headers: jsonHdr,
    body: JSON.stringify({ kind: "problem", content: "[E2E] 수업 달력 자료", lessonDate: "2026-08-19" }),
  });
  ok("lessonDate 자료 등록", Boolean(ld.body?.documentId));
  if (ld.body?.documentId) {
    const docList = await json("/api/documents", { headers: bearer(teacherTok) });
    ok(
      "lesson_date 조회 반영",
      ((docList.body?.documents ?? []) as { id: string; lesson_date: string | null }[]).some(
        (d) => d.id === ld.body.documentId && d.lesson_date === "2026-08-19"
      )
    );
    // 학생 화면 동기화 — 강사가 올린 날짜 자료가 학생 수업 달력 API에 그대로 보여야 한다
    const stLessons = await json(`/api/lessons?teacher=${tUid}`, { headers: bearer(studentTok) });
    ok(
      "학생 수업 달력 — 강사 등록분 동기화",
      ((stLessons.body?.lessons ?? []) as { id: string; date: string }[]).some(
        (l) => l.id === ld.body.documentId && l.date === "2026-08-19"
      )
    );
    ok("비인증 → /api/lessons 401", (await status(`/api/lessons?teacher=${tUid}`)) === 401);
    ok(
      "잘못된 lessonDate는 무시(null)",
      (await (async () => {
        const bad = await json("/api/documents", {
          method: "POST",
          headers: jsonHdr,
          body: JSON.stringify({ kind: "problem", content: "[E2E] 잘못된 날짜", lessonDate: "19/08/2026" }),
        });
        if (!bad.body?.documentId) return false;
        const l2 = await json("/api/documents", { headers: bearer(teacherTok) });
        const row = ((l2.body?.documents ?? []) as { id: string; lesson_date: string | null }[]).find(
          (d) => d.id === bad.body.documentId
        );
        await status(`/api/documents?id=${bad.body.documentId}`, { method: "DELETE", headers: bearer(teacherTok) });
        return row?.lesson_date === null;
      })())
    );
    ok(
      "달력 자료 삭제 200",
      (await status(`/api/documents?id=${ld.body.documentId}`, { method: "DELETE", headers: bearer(teacherTok) })) === 200
    );
  }
  } finally {
    if (acadId) await db.from("academies").update({ plan: prevPlan }).eq("id", acadId);
  }

  // ── 3. 학생 공용 엔드포인트 (전부 로그인 필수)
  section("학생 공용 엔드포인트");
  for (const p of ["/api/teachers", "/api/popular", "/api/quiz?teacher=x"]) {
    ok(`비로그인 → ${p} 401`, (await status(p)) === 401);
  }
  // 접속(출석) 기록 (v0.40.0)
  {
    ok("비로그인 → visit 401", (await status("/api/visit", { method: "POST" })) === 401);
    const vp = await json("/api/visit", { method: "POST", headers: bearer(studentTok) });
    ok("학생 접속 기록됨", vp.status === 200 && vp.body?.counted === true);
    const tv = await json("/api/visit", { method: "POST", headers: bearer(teacherTok) });
    ok("강사 접속은 출석 아님", tv.status === 200 && tv.body?.counted === false);
    const vs = await json("/api/visit", { headers: bearer(studentTok) });
    ok(
      "출석 요약 — 오늘 포함·연속 1 이상",
      vs.status === 200 && vs.body?.today === true && vs.body?.total >= 1 && vs.body?.streak >= 1,
      `total=${vs.body?.total} streak=${vs.body?.streak}`
    );
    const sl = await json("/api/students", { headers: bearer(teacherTok) });
    type SV = { id: string; visits: number };
    ok(
      "강사 학생 리포트에 접속 수 포함",
      sl.status === 200 && (sl.body?.students ?? []).every((s: SV) => typeof s.visits === "number"),
      `${(sl.body?.students ?? []).length}명`
    );
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

      // 오답 기록 유지 (v0.34.0): 틀림 → 기록 생김 → 다시 맞힘 → 사라지지 않고 cleared(극복)로 표시
      const ans = Number(graded.body?.answer ?? 0);
      const post = (chosen: number) =>
        json("/api/quiz/attempt", {
          method: "POST",
          headers: { ...bearer(studentTok), "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: first.id, chosen }),
        });
      await post((ans + 1) % 4); // 일부러 틀린다
      const n1 = await json("/api/quiz/attempt", { headers: bearer(studentTok) });
      type N = { id: string; cleared: boolean };
      const w1 = (n1.body?.notes ?? []).find((x: N) => x.id === first.id);
      ok("틀린 문제 오답노트에 기록", Boolean(w1) && w1.cleared === false);
      await post(ans); // 다시 맞힌다
      const n2 = await json("/api/quiz/attempt", { headers: bearer(studentTok) });
      const w2 = (n2.body?.notes ?? []).find((x: N) => x.id === first.id);
      ok("다시 맞혀도 기록 유지 (극복 표시)", Boolean(w2) && w2.cleared === true);
      ok(
        "극복 집계(overcome) 반영",
        typeof n2.body?.totals?.overcome === "number" && n2.body.totals.overcome >= 1,
        `overcome=${n2.body?.totals?.overcome}`
      );
      // 전체 오답 모드: teacher 없이 mode=wrong → 200, 극복한 문제는 재출제 대상에서 빠진다
      const allWrong = await json("/api/quiz?mode=wrong", { headers: bearer(studentTok) });
      ok("전체 오답 모드 200", allWrong.status === 200 && Array.isArray(allWrong.body?.questions));
      ok(
        "극복한 문제는 전체 오답 재출제에서 제외",
        !(allWrong.body?.questions ?? []).some((x: { id: string }) => x.id === first.id)
      );
    } else {
      skip("채점·오답노트", "생성된 문제가 없음 (강사가 '문제 만들기' 미실행)");
    }
    ok(
      "문제 목록에 teacher 필수 (전체 오답 모드 제외)",
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
      // ── 전체 과목(all=1) + 영역 다중 선택 (v0.36.0)
      {
        const allSet = await json("/api/bank?all=1&limit=5", { headers: bearer(studentTok) });
        ok("전체 과목 출제 200", allSet.status === 200 && (allSet.body?.questions ?? []).length > 0);
        // 같은 과목의 서로 다른 영역 2개를 콤마로 — 반환 문항의 area가 그 집합 안에만 있어야 한다
        const twoAreas = [
          ...new Set(
            (tree.body?.tree ?? [])
              .filter((t: { subject: string }) => t.subject === subj)
              .map((t: { area: string }) => t.area)
          ),
        ].slice(0, 2) as string[];
        if (twoAreas.length === 2) {
          const multi = await json(
            `/api/bank?subject=${encodeURIComponent(subj)}&area=${encodeURIComponent(twoAreas.join(","))}&limit=10`,
            { headers: bearer(studentTok) }
          );
          const qs2 = multi.body?.questions ?? [];
          ok(
            "영역 다중 필터 — 반환 문항이 선택 영역 안",
            multi.status === 200 && qs2.length > 0 && qs2.every((x: { area: string }) => twoAreas.includes(x.area)),
            `${qs2.length}문항 / 영역 ${twoAreas.join("·")}`
          );
        }
      }

      // ── CBT 모드: 회차 목록 · 문항 수 · 일괄 채점
      ok("트리 응답에 회차 목록 포함", Array.isArray(tree.body?.sources), `${(tree.body?.sources ?? []).length}개`);
      const src = (tree.body?.sources ?? []).find((x: { subject: string }) => x.subject === subj);
      if (src) {
        // 실제 CBT 클라이언트와 동일하게 category=이론 — 집계 뷰(bank_source_counts)도 이론만 센다
        const bySrc = await json(
          `/api/bank?subject=${encodeURIComponent(subj)}&source=${encodeURIComponent(src.source)}&category=${encodeURIComponent("이론")}&limit=30`,
          { headers: bearer(studentTok) }
        );
        ok("회차 지정 조회 200", bySrc.status === 200);
        ok(
          "회차 문항 수가 집계와 일치 (이론)",
          (bySrc.body?.total ?? 0) === src.count,
          `${bySrc.body?.total} vs ${src.count}`
        );
      }
      // 문항 수 선택이 실제로 반영되는지
      const five = await json(`/api/bank?subject=${encodeURIComponent(subj)}&category=이론&limit=5`, {
        headers: bearer(studentTok),
      });
      ok("limit=5 반영", (five.body?.questions ?? []).length === 5, `${(five.body?.questions ?? []).length}문항`);

      // 일괄 채점 (CBT): 한 번의 요청으로 여러 문항
      const batchQs = (five.body?.questions ?? []).filter((q: { type: string }) => q.type === "theory");
      if (batchQs.length >= 2) {
        const batch = await json("/api/bank/attempt", {
          method: "POST",
          headers: { ...bearer(studentTok), "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: batchQs.map((q: { id: string }) => ({ questionId: q.id, chosen: 0 })),
            subject: subj,
            source: "[E2E] 세션",
          }),
        });
        ok("배치 채점 200", batch.status === 200, `status=${batch.status}`);
        ok(
          "배치 결과 수 일치",
          (batch.body?.results ?? []).length === batchQs.length,
          `${(batch.body?.results ?? []).length}/${batchQs.length}`
        );
        ok("배치 응답에 정답·해설 포함", "answerIdx" in ((batch.body?.results ?? [])[0] ?? {}));
        ok("배치 기록 저장", batch.body?.saved === true);
        ok(
          "잘못된 배치는 400",
          (await status("/api/bank/attempt", {
            method: "POST",
            headers: { ...bearer(studentTok), "Content-Type": "application/json" },
            body: JSON.stringify({ answers: [{ questionId: "nope", chosen: 9 }] }),
          })) === 400
        );

        // 시험 기록: 배치 채점이 bank_sessions에 남고 → 내 기록·이름 검색으로 조회
        const myRec = await json("/api/bank/records", { headers: bearer(studentTok) });
        ok(
          "내 시험 기록 조회",
          (myRec.body?.records ?? []).some((r: { source: string | null }) => r.source === "[E2E] 세션")
        );
        const byName = await json(`/api/bank/records?name=${encodeURIComponent("테스트")}`, {
          headers: bearer(teacherTok),
        });
        ok(
          "이름 검색으로 기록 조회 (같은 학원)",
          (byName.body?.records ?? []).some(
            (r: { source: string | null; name?: string }) => r.source === "[E2E] 세션"
          )
        );
        ok("비인증 → 기록 401", (await status("/api/bank/records")) === 401);
        // 풀이 통계 — 정답률/과목별/유형별
        const st = await json("/api/bank/stats", { headers: bearer(studentTok) });
        ok(
          "풀이 통계 조회 (정답률·유형별)",
          st.status === 200 &&
            typeof st.body?.stats?.totals?.rate === "number" &&
            Array.isArray(st.body?.stats?.byTag)
        );
        const stByName = await json(`/api/bank/stats?name=${encodeURIComponent("테스트")}`, {
          headers: bearer(teacherTok),
        });
        ok("이름으로 통계 조회 (강사)", stByName.status === 200 && stByName.body?.stats !== undefined);
        ok("비인증 → 통계 401", (await status("/api/bank/stats")) === 401);
        // 한 문제씩 모드 완주 기록 (클라이언트 POST 경로)
        ok(
          "세션 기록 POST 200",
          (await status("/api/bank/records", {
            method: "POST",
            headers: { ...bearer(studentTok), "Content-Type": "application/json" },
            body: JSON.stringify({ subject: "[E2E] 과목", total: 5, score: 4 }),
          })) === 200
        );
        ok(
          "점수>문항수 기록 400",
          (await status("/api/bank/records", {
            method: "POST",
            headers: { ...bearer(studentTok), "Content-Type": "application/json" },
            body: JSON.stringify({ subject: "[E2E] 과목", total: 5, score: 9 }),
          })) === 400
        );
        // 정리 — [E2E] 세션 기록 삭제
        {
          const stUid2 = JSON.parse(Buffer.from(studentTok.split(".")[1], "base64").toString()).sub as string;
          await db.from("bank_sessions").delete().eq("user_id", stUid2).eq("source", "[E2E] 세션");
          await db.from("bank_sessions").delete().eq("user_id", stUid2).eq("subject", "[E2E] 과목");
        }

        // 문제모음 검색
        const bs = await json(
          `/api/bank/search?subject=${encodeURIComponent(subj)}&q=${encodeURIComponent("재무")}`,
          { headers: bearer(studentTok) }
        );
        ok(
          "문제모음 검색 — 키워드 포함 문제 반환",
          bs.status === 200 &&
            (bs.body?.questions ?? []).length > 0 &&
            (bs.body.questions as { stem: string }[]).every((x) => x.stem.includes("재무"))
        );
        ok(
          "문제모음 검색 — 한 글자 400",
          (await status(`/api/bank/search?subject=${encodeURIComponent(subj)}&q=재`, {
            headers: bearer(studentTok),
          })) === 400
        );
        ok("비인증 → 문제모음 401", (await status("/api/bank/search?subject=x&q=재무")) === 401);

        // 이론/실무 분리 검색 (v0.37.0)
        type SearchQ = { category: string; answerText: string | null };
        const th = await json(
          `/api/bank/search?subject=${encodeURIComponent(subj)}&q=${encodeURIComponent("재무")}&kind=theory`,
          { headers: bearer(studentTok) }
        );
        ok(
          "이론 검색 — 이론만 반환",
          th.status === 200 &&
            (th.body?.questions ?? []).length > 0 &&
            (th.body.questions as SearchQ[]).every((x) => x.category === "이론")
        );
        const pr = await json(
          `/api/bank/search?subject=${encodeURIComponent(subj)}&q=${encodeURIComponent("외상매출금")}&kind=practice`,
          { headers: bearer(studentTok) }
        );
        ok(
          "실무 검색 — 비이론만 + 정답(answerText) 포함",
          pr.status === 200 &&
            (pr.body?.questions ?? []).length > 0 &&
            (pr.body.questions as SearchQ[]).every((x) => x.category !== "이론" && Boolean(x.answerText)),
          `${(pr.body?.questions ?? []).length}건`
        );

        // 이론 통합 검색 (v0.38.0) — subject 없이 전 급수, 행마다 급수 태그(subject) 실림
        const un = await json(`/api/bank/search?q=${encodeURIComponent("감가상각")}&kind=theory`, {
          headers: bearer(studentTok),
        });
        type UnQ = { subject: string; category: string };
        const unQs = (un.body?.questions ?? []) as UnQ[];
        ok(
          "이론 통합 검색 — subject 없이 200 + 전 행에 급수 포함",
          un.status === 200 && unQs.length > 0 && unQs.every((x) => Boolean(x.subject) && x.category === "이론"),
          `${unQs.length}건 · 급수 ${[...new Set(unQs.map((x) => x.subject))].join("·")}`
        );

        // 실무 재분류 (v0.39.0): 세무는 일반전표·매입매출전표·결산 3분류, 회계는 일반전표·결산 2분류
        type TR = { subject: string; category: string };
        const cats = (subj2: string) =>
          [...new Set(((tree.body?.tree ?? []) as TR[]).filter((t) => t.subject === subj2 && t.category !== "이론").map((t) => t.category))].sort();
        ok(
          "세무2급 실무 = 결산·매입매출전표·일반전표",
          JSON.stringify(cats("전산세무2급")) === JSON.stringify(["결산", "매입매출전표", "일반전표"]),
          cats("전산세무2급").join(",")
        );
        ok(
          "회계1급 실무 = 결산·일반전표 (매입매출 없음)",
          JSON.stringify(cats("전산회계1급")) === JSON.stringify(["결산", "일반전표"]),
          cats("전산회계1급").join(",")
        );
        ok("실무분개 카테고리 소멸", !((tree.body?.tree ?? []) as TR[]).some((t) => t.category === "실무분개"));
      }

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

        // "몰라요" — 오답 기록 + 정답·해설 공개
        const gu = await json("/api/bank/attempt", {
          method: "POST",
          headers: { ...bearer(studentTok), "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: theory.id, giveUp: true }),
        });
        ok(
          "몰라요 — 오답 기록·정답 반환",
          gu.status === 200 && gu.body?.correct === false && "answer_idx" in (gu.body ?? {}) && gu.body?.saved === true
        );
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

  // ── 7.45 휴대폰 뒷자리 가입 (변경 강제 없음 — v0.29.1부터 뒷 4자리 유지)
  section("휴대폰 가입 · 비밀번호 변경");
  {
    const phId = `e2e-ph-${Date.now()}`;
    const phone = "010-1234-9876";
    const tail = "9876"; // 뒷 4자리 = 초기 비밀번호
    const su = await json("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "student", email: phId, name: "[E2E] 폰가입", phone }),
    });
    ok("휴대폰만으로 학생 가입 200", su.status === 200, `status=${su.status}`);

    // 가입은 아이디만 — 이메일 주소는 전 역할에서 거부한다
    for (const role of ["student", "teacher", "admin"]) {
      ok(
        `${role} 이메일 가입 400`,
        (await status("/api/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, email: `x${Date.now()}@gmail.com`, password: "e2epass1234", name: "x", phone }),
        })) === 400
      );
    }

    const phTok = await login(`${phId}@ssaem.kr`, tail);
    ok("휴대폰 뒷자리로 로그인됨", Boolean(phTok));

    if (phTok) {
      const prof = await json("/api/profile", { headers: bearer(phTok) });
      // 변경 강제를 뺐다(v0.29.1) — 뒷 4자리를 그대로 쓴다
      ok("변경 강제 플래그 없음", prof.body?.profile?.mustChangePassword === false);

      // 받은 휴대폰이 학생 상세정보로 저장됐는지 (강사가 따로 입력 안 해도 되게)
      const stuId = su.body?.userId;
      if (stuId) {
        const det = await json(`/api/students/detail?student=${stuId}`, { headers: bearer(teacherTok) });
        // 서버가 하이픈을 벗겨 숫자만 저장한다 (v0.28.2)
        ok(
          "가입 시 받은 연락처 자동 저장 (숫자만)",
          det.body?.detail?.phone === phone.replace(/\D/g, ""),
          det.body?.detail?.phone ?? "없음"
        );
        // 초대코드 없는 가입은 선생님 자동 연결이 없어야 한다 (v0.30.0 — /ask 코드 입력으로 직접 등록)
        const { count: enr0 } = await db
          .from("enrollments")
          .select("student_id", { count: "exact", head: true })
          .eq("student_id", stuId);
        ok("코드 없는 가입 — 수강 연결 0건", (enr0 ?? 0) === 0, `${enr0}건`);

        // 연결 0건이면 /ask 선생님 목록도 비어야 한다 (v0.33.0 — 학생은 수강 연결된 강사만 보임)
        const tl = await json("/api/teachers", { headers: bearer(phTok) });
        ok(
          "코드 없는 가입 — /api/teachers 빈 목록",
          (tl.body?.teachers ?? []).length === 0,
          `${(tl.body?.teachers ?? []).length}명`
        );
      }

      // 약한 비밀번호 거부
      ok(
        "짧은 비밀번호 400",
        (await status("/api/password", {
          method: "POST",
          headers: { ...bearer(phTok), "Content-Type": "application/json" },
          body: JSON.stringify({ password: "abc123" }),
        })) === 400
      );
      ok(
        "숫자만 비밀번호 400",
        (await status("/api/password", {
          method: "POST",
          headers: { ...bearer(phTok), "Content-Type": "application/json" },
          body: JSON.stringify({ password: "12345678" }),
        })) === 400
      );
      ok(
        "비로그인 비밀번호 변경 401",
        (await status("/api/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "newpass2026" }),
        })) === 401
      );

      const changed = await json("/api/password", {
        method: "POST",
        headers: { ...bearer(phTok), "Content-Type": "application/json" },
        body: JSON.stringify({ password: "e2epass2026" }),
      });
      ok("비밀번호 변경 200", changed.status === 200, `status=${changed.status}`);

      // 비밀번호를 바꾸면 기존 access token은 무효가 된다 — 새 토큰으로 확인해야 한다
      const newTok = await login(`${phId}@ssaem.kr`, "e2epass2026");
      ok("새 비밀번호로 로그인", Boolean(newTok));
      const prof2 = await json("/api/profile", { headers: bearer(newTok!) });
      ok(
        "변경 후 플래그 해제",
        prof2.body?.profile?.mustChangePassword === false,
        `status=${prof2.status} flag=${prof2.body?.profile?.mustChangePassword}`
      );
      ok("옛 비밀번호(뒷자리)는 막힘", !(await login(`${phId}@ssaem.kr`, tail)));

      if (stuId) {
        await db.from("student_details").delete().eq("student_id", stuId);
        await db.auth.admin.deleteUser(stuId);
      }
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

  // ── 7.35 평가 세트 (업로드 → 응시 → 채점 → 1회 제한)
  section("평가 세트");
  const hasAs = await tableExists("assessments", "title");
  if (!hasAs) {
    skip("평가 전 구간", "assessments 테이블 없음 — supabase/실행할-SQL.sql 미실행");
  } else {
    // 업로드용 CSV (엑셀 대신 CSV로 — 파서는 같은 경로를 탄다)
    const csv = [
      "문제,보기1,보기2,보기3,보기4,정답,해설",
      "[E2E] 차변에 오는 것은?,자산의 증가,자산의 감소,부채의 증가,수익의 발생,1,차변은 자산의 증가",
      "[E2E] 대변에 오는 것은?,비용의 발생,자산의 증가,수익의 발생,자산의 감소,3,대변은 수익의 발생",
      "[E2E] 깨진 줄,보기만 있음,,,,9,",
    ].join("\n");

    async function upload(tok: string, title: string) {
      const fd = new FormData();
      fd.append("file", new Blob([csv], { type: "text/csv" }), "e2e.csv");
      fd.append("title", title);
      const r = await fetch(`${BASE}/api/assessments`, { method: "POST", headers: bearer(tok), body: fd });
      return { status: r.status, body: await r.json().catch(() => null) };
    }

    // 학생은 업로드 불가
    const stuUp = await upload(studentTok, "[E2E] 학생업로드");
    ok("학생 평가 업로드 403", stuUp.status === 403, `status=${stuUp.status}`);

    const up = await upload(teacherTok, "[E2E] 평가");
    ok("강사 평가 업로드 200", up.status === 200, `status=${up.status}`);
    ok("정상 2문항 생성", up.body?.created === 2, `created=${up.body?.created}`);
    ok("깨진 줄 1건 건너뜀", up.body?.skipped === 1, `skipped=${up.body?.skipped}`);

    const asId: string | undefined = up.body?.id;
    if (!asId) {
      skip("평가 응시 구간", "평가 생성 실패");
    } else {
      const list = await json(`/api/assessments?teacher=${t0.id}`, { headers: bearer(studentTok) });
      ok("학생 평가 목록 200", list.status === 200);
      const mineSet = (list.body?.assessments ?? []).find((a: { id: string }) => a.id === asId);
      ok("올린 평가가 목록에 보임", Boolean(mineSet), mineSet ? `${mineSet.questions}문항` : "없음");

      const qres = await json(`/api/assessments/${asId}/questions`, { headers: bearer(studentTok) });
      ok("응시 문항 200", qres.status === 200);
      const first = qres.body?.questions?.[0];
      ok(
        "문항 응답에 정답·해설 미포함",
        !first || (!("answer" in first) && !("explanation" in first)),
        first ? Object.keys(first).join(",") : "문항 없음"
      );

      // 1번 문항은 정답(0), 2번은 오답(0) → 1/2점
      const answers = (qres.body?.questions ?? []).map((q: { id: string }) => ({ questionId: q.id, chosen: 0 }));
      const sub = await json(`/api/assessments/${asId}/submit`, {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ answers, signature: "data:image/png;base64," + "A".repeat(4000) }),
      });
      ok("제출 200", sub.status === 200, `status=${sub.status}`);
      ok("서버 채점 1/2", sub.body?.score === 1 && sub.body?.total === 2, `${sub.body?.score}/${sub.body?.total}`);
      ok("채점 후 정답·해설 공개", Boolean(sub.body?.results?.[0] && "answer" in sub.body.results[0]));
      ok("서명 기록됨", Boolean(sub.body?.signedAt), sub.body?.signedAt ?? "없음");

      // 1회 제한
      const again = await json(`/api/assessments/${asId}/submit`, {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      ok("재응시 409 차단", again.status === 409, `status=${again.status}`);
      const qAgain = await json(`/api/assessments/${asId}/questions`, { headers: bearer(studentTok) });
      ok("응시 후 문항 재조회도 409", qAgain.status === 409, `status=${qAgain.status}`);

      // 잘못된 서명은 거부 (형식 검증이 제출 경로에도 걸리는지)
      const badSig = await json(`/api/assessments/${asId}/submit`, {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ answers, signature: "data:image/svg+xml;base64,AAAA" }),
      });
      ok("PNG 아닌 서명 400", badSig.status === 400, `status=${badSig.status}`);

      // 결과 조회·CSV (강사·원장만)
      ok(
        "학생 결과 조회 403",
        (await status(`/api/assessments/${asId}/results`, { headers: bearer(studentTok) })) === 403
      );
      const res = await json(`/api/assessments/${asId}/results`, { headers: bearer(teacherTok) });
      ok("강사 결과 조회 200", res.status === 200, `status=${res.status}`);
      ok("응시 1건 집계", res.body?.attempts === 1, `attempts=${res.body?.attempts}`);
      const row0 = res.body?.results?.[0];
      ok("점수·정답률 포함", row0?.score === 1 && row0?.percent === 50, `${row0?.score}/${row0?.total} ${row0?.percent}%`);
      ok("문항별 정오 문자열", /^[OX-]+$/.test(row0?.marks ?? ""), row0?.marks ?? "없음");
      ok("서명 시각 포함", Boolean(row0?.signedAt), row0?.signedAt ?? "없음");
      ok("학생 이름 포함(강사·원장용)", Boolean(row0?.student), row0?.student ?? "없음");
      ok(
        "원장도 우리 학원 평가 결과 조회",
        (await status(`/api/assessments/${asId}/results`, { headers: bearer(adminTok) })) === 200
      );

      const csvRes = await fetch(`${BASE}/api/assessments/${asId}/results?csv=1`, {
        headers: bearer(teacherTok),
      });
      // Response.text()는 UTF-8 디코딩하며 BOM을 지운다 — BOM 검사는 원시 바이트로 해야 한다
      const csvBytes = new Uint8Array(await csvRes.clone().arrayBuffer());
      const csvText = await csvRes.text();
      ok("CSV 응답 200", csvRes.status === 200);
      ok(
        "CSV Content-Type",
        (csvRes.headers.get("content-type") ?? "").includes("text/csv"),
        csvRes.headers.get("content-type") ?? ""
      );
      ok("CSV 첨부 헤더", (csvRes.headers.get("content-disposition") ?? "").includes("attachment"));
      ok(
        "CSV BOM (엑셀 한글 깨짐 방지)",
        csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
        `${csvBytes[0]?.toString(16)} ${csvBytes[1]?.toString(16)} ${csvBytes[2]?.toString(16)}`
      );
      ok("CSV 한글 헤더", csvText.includes("제출시각") && csvText.includes("문항별정오"));
      ok("CSV 데이터 행 존재", csvText.trim().split("\r\n").length === 2, `${csvText.trim().split("\r\n").length}줄`);

      // 강사 삭제 (남의 평가는 못 지운다 — 소유권 필터)
      ok(
        "학생 평가 삭제 403",
        (await status(`/api/assessments?id=${asId}`, { method: "DELETE", headers: bearer(studentTok) })) === 403
      );
      // 삭제 전 서명이 실제로 있는지 확인 (아래 회귀 검사가 의미를 가지려면 선행 조건)
      const { count: sigBefore } = await db
        .from("signatures")
        .select("id", { count: "exact", head: true })
        .eq("kind", "assessment");
      ok(
        "강사 본인 평가 삭제 200",
        (await status(`/api/assessments?id=${asId}`, { method: "DELETE", headers: bearer(teacherTok) })) === 200
      );
      // signatures.ref_id는 FK가 아니라 cascade가 안 걸린다 — 라우트가 직접 지워야 한다.
      // 안 지우면 응시 기록 없는 서명 이미지(개인정보)가 계속 남는다.
      const { count: sigAfter } = await db
        .from("signatures")
        .select("id", { count: "exact", head: true })
        .eq("kind", "assessment");
      ok(
        "평가 삭제 시 서명도 함께 삭제(고아 방지)",
        (sigAfter ?? 0) < (sigBefore ?? 0),
        `${sigBefore} → ${sigAfter}`
      );
      const after = await json(`/api/assessments?teacher=${t0.id}`, { headers: bearer(studentTok) });
      ok(
        "삭제 후 목록에서 사라짐",
        !(after.body?.assessments ?? []).some((a: { id: string }) => a.id === asId)
      );
    }
  }

  // ── 7.4 전자서명 (평가 본인 확인)
  section("전자서명");
  const hasSig = await tableExists("signatures", "image");
  if (!hasSig) {
    skip("전자서명 전 구간", "signatures 테이블 없음 — 20260818000000_signatures.sql 미실행");
  } else {
    const bigPng = "data:image/png;base64," + "A".repeat(4000);
    ok(
      "비로그인 서명 401",
      (await status("/api/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "assessment", image: bigPng }),
      })) === 401
    );
    const badKind = await json("/api/signature", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "nope", image: bigPng }),
    });
    ok("알 수 없는 kind 400", badKind.status === 400);
    const badImg = await json("/api/signature", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "assessment", image: "data:image/svg+xml;base64,AAAA" }),
    });
    ok("PNG 아닌 서명 거부 400", badImg.status === 400);
    const blank = await json("/api/signature", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "assessment", image: "data:image/png;base64,AAAA" }),
    });
    ok("빈 서명 거부 400", blank.status === 400);

    const saved = await json("/api/signature", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "assessment", image: bigPng }),
    });
    ok("서명 저장 200", saved.status === 200 && Boolean(saved.body?.id), `status=${saved.status}`);

    const mine = await json("/api/signature?kind=assessment", { headers: bearer(studentTok) });
    ok(
      "본인 서명 조회",
      mine.status === 200 && (mine.body?.signatures ?? []).some((r: { id: string }) => r.id === saved.body?.id)
    );
    // 남의 서명은 안 보여야 한다 (조회는 항상 본인 필터)
    const others = await json("/api/signature?kind=assessment", { headers: bearer(teacherTok) });
    ok(
      "남의 서명 미노출",
      others.status === 200 &&
        !(others.body?.signatures ?? []).some((r: { id: string }) => r.id === saved.body?.id)
    );
    // 응답에 image 원문을 싣지 않는다 (목록에서 서명 이미지 유출 방지)
    ok(
      "조회 응답에 서명 이미지 미포함",
      !(mine.body?.signatures ?? []).some((r: Record<string, unknown>) => "image" in r)
    );
    if (saved.body?.id) await db.from("signatures").delete().eq("id", saved.body.id);
  }

  // ── 7.5 수강평 (D) + 학생 상세정보 (E)
  section("수강평 · 학생정보");
  const hasRev = await tableExists("course_reviews", "rating");
  const hasDetail = await tableExists("student_details", "phone");
  if (!hasRev || !hasDetail) {
    skip("수강평·학생정보 전 구간", "테이블 없음 — supabase/실행할-SQL-2.sql 미실행");
  } else {
    // 강사는 수강평을 못 쓴다 (자기 평점 조작 차단)
    ok(
      "강사 수강평 작성 403",
      (await status("/api/reviews", {
        method: "POST",
        headers: { ...bearer(teacherTok), "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: t0.id, rating: 5 }),
      })) === 403
    );
    ok(
      "비로그인 수강평 401",
      (await status("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: t0.id, rating: 5 }),
      })) === 401
    );
    // 별점 범위 검증
    ok(
      "별점 범위 밖 400",
      (await status("/api/reviews", {
        method: "POST",
        headers: { ...bearer(studentTok), "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId: t0.id, rating: 9 }),
      })) === 400
    );

    const wrote = await json("/api/reviews", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: t0.id, rating: 4, comment: "[E2E] 설명이 이해하기 쉬웠어요" }),
    });
    ok("학생 수강평 작성 200", wrote.status === 200, `status=${wrote.status}`);

    // 같은 강사에 다시 쓰면 수정(upsert) — 중복 생성 아님
    const again = await json("/api/reviews", {
      method: "POST",
      headers: { ...bearer(studentTok), "Content-Type": "application/json" },
      body: JSON.stringify({ teacherId: t0.id, rating: 5, comment: "[E2E] 수정본" }),
    });
    ok("같은 강사 재작성은 수정", again.status === 200);
    const mineRes = await json("/api/reviews", { headers: bearer(studentTok) });
    const mineRows = (mineRes.body?.mine ?? []).filter((m: { teacherId: string }) => m.teacherId === t0.id);
    ok("내 수강평 1건만 유지(중복 없음)", mineRows.length === 1, `${mineRows.length}건`);
    ok("수정된 별점 반영", mineRows[0]?.rating === 5, `rating=${mineRows[0]?.rating}`);

    // 강사 조회 — 작성자 익명이어야 한다
    const tRev = await json("/api/reviews", { headers: bearer(teacherTok) });
    ok("강사 수강평 조회 200", tRev.status === 200);
    ok("강사 평균 별점 계산", typeof tRev.body?.avg === "number", `avg=${tRev.body?.avg}`);
    const tRow = (tRev.body?.reviews ?? [])[0];
    ok(
      "강사 응답에 작성자 정보 없음(익명)",
      !tRow || (!("student" in tRow) && !("studentId" in tRow) && !("student_id" in tRow)),
      tRow ? Object.keys(tRow).join(",") : "없음"
    );
    ok("강사 응답 전체에 학생 이름 미포함", !JSON.stringify(tRev.body ?? {}).includes("테스트 학생"));

    // 원장 조회 — 작성자 실명 포함
    const aRev = await json("/api/reviews", { headers: bearer(adminTok) });
    ok("원장 수강평 조회 200", aRev.status === 200);
    const aRow = (aRev.body?.reviews ?? []).find((r: { comment: string | null }) =>
      (r.comment ?? "").includes("[E2E]")
    );
    ok("원장 응답엔 작성자 실명 포함", Boolean(aRow?.student), aRow?.student ?? "없음");
    ok("원장 강사별 집계 제공", Array.isArray(aRev.body?.byTeacher) && aRev.body.byTeacher.length > 0);

    // ── 학생 상세정보 (E)
    const stuList = await json("/api/students", { headers: bearer(teacherTok) });
    const stu = (stuList.body?.students ?? [])[0];
    if (!stu) {
      skip("학생 상세정보", "강사에게 연결된 학생 없음");
    } else {
      ok(
        "학생이 남의 상세정보 조회 403",
        (await status(`/api/students/detail?student=${stu.id}`, { headers: bearer(studentTok) })) === 403
      );
      ok(
        "비로그인 상세정보 401",
        (await status(`/api/students/detail?student=${stu.id}`)) === 401
      );
      const saved = await json("/api/students/detail", {
        method: "POST",
        headers: { ...bearer(teacherTok), "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: stu.id, phone: "010-0000-0000", note: "[E2E] 메모" }),
      });
      ok("강사 상세정보 저장 200", saved.status === 200, `status=${saved.status}`);
      const got = await json(`/api/students/detail?student=${stu.id}`, { headers: bearer(teacherTok) });
      ok("강사 상세정보 조회", got.body?.detail?.phone === "010-0000-0000", got.body?.detail?.phone ?? "없음");
      const gotAdmin = await json(`/api/students/detail?student=${stu.id}`, { headers: bearer(adminTok) });
      ok("원장도 같은 학원 학생 열람", gotAdmin.body?.detail?.note === "[E2E] 메모");
      // 학생 목록(공용 조회)에는 연락처가 실리면 안 된다
      ok(
        "학생 목록 응답에 연락처 미포함",
        !JSON.stringify(stuList.body ?? {}).includes("010-0000-0000")
      );
      await db.from("student_details").delete().eq("student_id", stu.id);
    }

    await db.from("course_reviews").delete().eq("teacher_id", t0.id).ilike("comment", "%[E2E]%");
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

  // ── 8.9 에러 내성 하네스 — 오입력·깨진 요청에 500이 아니라 4xx로 응답해야 한다.
  // 새 API를 만들면 여기에 오입력 케이스를 추가할 것 (500 = 방어 누락 신호).
  section("에러 내성 — 오입력 전수 (5xx 금지)");
  {
    const js = { ...bearer(studentTok), "Content-Type": "application/json" };
    const jt2 = { ...bearer(teacherTok), "Content-Type": "application/json" };
    const bad = async (name: string, path: string, init?: RequestInit) => {
      const st = await status(path, init);
      ok(`${name} → ${st}`, st < 500, `status=${st}`);
    };
    // 페이지: 없는 주소는 404 화면
    {
      const r = await fetch(`${BASE}/no-such-page-xyz`);
      const html = await r.text();
      ok("없는 페이지 404 + 안내 화면", r.status === 404 && html.includes("페이지를 찾을 수 없어요"), `status=${r.status}`);
    }
    // API: 깨진 JSON / 빈 body / 잘못된 id
    await bad("ask 빈 body", "/api/ask", { method: "POST", headers: js, body: "{}" });
    await bad("ask 깨진 JSON", "/api/ask", { method: "POST", headers: js, body: "{broken" });
    await bad("signup 빈 body", "/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await bad("signup 깨진 JSON", "/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{{{" });
    await bad("join 쓰레기 코드", `/api/join?code=${encodeURIComponent("x.y.z")}`);
    await bad("join POST 쓰레기 코드", "/api/join", { method: "POST", headers: js, body: JSON.stringify({ code: "garbage" }) });
    await bad("courses PATCH 잘못된 id", "/api/courses", { method: "PATCH", headers: jt2, body: JSON.stringify({ id: "nope", title: "x" }) });
    await bad("documents DELETE 잘못된 id", "/api/documents?id=zzz", { method: "DELETE", headers: bearer(teacherTok) });
    await bad("documents POST 깨진 JSON", "/api/documents", { method: "POST", headers: jt2, body: "{" });
    await bad("bank 없는 과목", `/api/bank?subject=${encodeURIComponent("없는과목")}`, { headers: bearer(studentTok) });
    await bad("bank/attempt 깨진 JSON", "/api/bank/attempt", { method: "POST", headers: js, body: "{{{" });
    await bad("bank/attempt 잘못된 uuid", "/api/bank/attempt", { method: "POST", headers: js, body: JSON.stringify({ questionId: "abc", chosen: 1 }) });
    await bad("bank/search 파라미터 없음", "/api/bank/search", { headers: bearer(studentTok) });
    await bad("bank/records 엉터리 POST", "/api/bank/records", { method: "POST", headers: js, body: JSON.stringify({ subject: "", total: -1, score: 99 }) });
    await bad("bank/stats 특수문자 이름", `/api/bank/stats?name=${encodeURIComponent("%_\\")}`, { headers: bearer(teacherTok) });
    await bad("records 특수문자 이름", `/api/bank/records?name=${encodeURIComponent("%_\\")}`, { headers: bearer(teacherTok) });
    await bad("quiz 잘못된 teacher", "/api/quiz?teacher=nope", { headers: bearer(studentTok) });
    await bad("lessons 잘못된 teacher", "/api/lessons?teacher=nope", { headers: bearer(studentTok) });
    await bad("courses 잘못된 teacher", "/api/courses?teacher=nope", { headers: bearer(studentTok) });
    await bad("invite 잘못된 course", "/api/invite?course=nope", { headers: bearer(teacherTok) });
    await bad("students/detail 잘못된 student", "/api/students/detail?student=zzz", { headers: bearer(teacherTok) });
    await bad("upload 폼 없음", "/api/upload", { method: "POST", headers: bearer(teacherTok) });
    await bad("assessments POST 폼 없음", "/api/assessments", { method: "POST", headers: bearer(teacherTok) });
    await bad("password null body", "/api/password", { method: "POST", headers: js, body: "null" });
    await bad("profile POST 깨진 JSON", "/api/profile", { method: "POST", headers: jt2, body: "{" });
    await bad("feedback 빈 body", "/api/feedback", { method: "POST", headers: js, body: "{}" });
    await bad("quiz/attempt 빈 body", "/api/quiz/attempt", { method: "POST", headers: js, body: "{}" });
    await bad("conversations 잘못된 id", "/api/conversations?id=zzz", { headers: bearer(studentTok) });
    await bad("related 빈 q", "/api/related?teacher=x&q=", { headers: bearer(studentTok) });
    await bad("reviews 엉터리 POST", "/api/reviews", { method: "POST", headers: js, body: "{}" });
  }

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
