"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import AssessmentRunner from "@/components/AssessmentRunner";

type Teacher = { id: string; name: string; subject: string | null };
type Course = { id: string; title: string };
// 공부 모드일 때만 answer·explanation가 함께 온다
type Q = { id: string; question: string; choices: string[]; answer?: number; explanation?: string };
type Graded = { correct: boolean; answer: number; explanation: string };

export default function QuizPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <QuizInner />
    </Suspense>
  );
}

function QuizInner() {
  const params = useSearchParams();
  const mode = params.get("mode") === "wrong" ? "wrong" : "all";
  // 오답 전체 모드: teacher 없이 mode=wrong — 모든 선생님의 내 오답을 한 번에 다시 푼다
  const wrongAll = mode === "wrong" && !params.get("teacher");

  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  // 오답노트에서 넘어올 때 선생님이 실려온다 — 없으면 목록 첫 번째
  const [teacherId, setTeacherId] = useState(params.get("teacher") ?? "");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");

  const [qs, setQs] = useState<Q[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [needLogin, setNeedLogin] = useState(false);
  // 공부 모드: 문제 옆에 정답·해설을 처음부터 보여주는 복습 모드 (채점 없음)
  const [study, setStudy] = useState(false);
  // 탭: 연습문제(자료로 만든 문제) / 평가(선생님이 올린 시험)
  const [tab, setTab] = useState<"practice" | "exam">("practice");

  // 문제풀이도 로그인 계정에서만 — 채점 기록이 남아야 오답노트가 의미가 있다
  const { session, gate } = useGate("any", { loginMessage: "문제풀이 기록은 계정에 저장돼요." });

  // 세션 확정 후 로드 — 토큰을 보내야 초대받은 비공개 강사도 목록에 들어온다
  useEffect(() => {
    if (!session) return;
    fetch("/api/teachers", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const list: Teacher[] = d.teachers ?? [];
        setTeachers(list);
        // 전체 오답 모드에선 특정 선생님을 자동 선택하지 않는다 (빈 teacherId = 전체)
        if (!wrongAll) setTeacherId((cur) => cur || list[0]?.id || "");
      })
      .catch(() => setTeachers([]));
  }, [session, wrongAll]);

  useEffect(() => {
    if (!teacherId || !session) return;
    fetch(`/api/courses?teacher=${teacherId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setCourses(d.courses ?? []))
      .catch(() => setCourses([]));
  }, [teacherId, session]);

  // 상태 초기화를 await 뒤로 모았다 — 이펙트 본문에서 동기 setState를 하면
  // 렌더가 연쇄로 돌아 react-hooks/set-state-in-effect에 걸린다.
  const load = useCallback(async () => {
    if ((!teacherId && !wrongAll) || tab !== "practice") return; // 평가 탭에선 연습문제를 부르지 않는다
    const r = await fetch(
      `/api/quiz?${teacherId ? `teacher=${teacherId}&` : ""}${courseId ? `course=${courseId}&` : ""}mode=${mode}${study ? "&study=1" : ""}`,
      { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} }
    );
    const d = await r.json().catch(() => null);
    setIdx(0);
    setPicked(null);
    setGraded(null);
    setScore({ right: 0, done: 0 });
    setNeedLogin(Boolean(d?.needLogin));
    if (!r.ok) {
      setErr(d?.error ?? "문제를 불러오지 못했어요.");
      setQs([]);
      return;
    }
    setErr("");
    setQs(d.questions ?? []);
  }, [teacherId, courseId, mode, session, study, tab, wrongAll]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load의 setState는 모두 await 이후라 동기 캐스케이드 아님
    load();
  }, [load]);

  async function submit(choice: number) {
    if (graded || busy || !qs) return;
    setPicked(choice);
    setBusy(true);
    try {
      const r = await fetch("/api/quiz/attempt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ questionId: qs[idx].id, chosen: choice }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "채점하지 못했어요.");
      setGraded(d);
      setScore((s) => ({ right: s.right + (d.correct ? 1 : 0), done: s.done + 1 }));
    } catch {
      // 네트워크 throw 시 busy가 영원히 true로 남아 퀴즈가 잠기던 것 방지
      setErr("네트워크 오류로 채점하지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function next() {
    setPicked(null);
    setGraded(null);
    setIdx((i) => i + 1);
  }

  // 공부 모드 앞뒤 이동 (채점 상태 리셋 불필요 — 채점 안 함)
  function studyGo(delta: number) {
    setIdx((i) => Math.min(Math.max(i + delta, 0), (qs?.length ?? 1) - 1));
  }

  const q = qs?.[idx];
  // 공부 모드엔 '결과' 화면이 없다 (점수 채점을 안 하므로)
  const finished = !study && qs !== null && qs.length > 0 && idx >= qs.length;

  if (gate) return gate;

  // 화면 폭: PC에선 컨트롤 좌레일 + 문제 우측 2단(5xl). 공부 모드는 문제·해설이 또 2단이라 더 넓게 (bank과 동일 패턴)
  const width = study && qs?.length ? "max-w-[1240px]" : "max-w-2xl lg:max-w-5xl";

  return (
    <main className={`flex-1 w-full ${width} mx-auto px-5 py-8 flex flex-col gap-4`}>
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <BackButton fallback="/ask" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">
            {mode === "wrong" ? "오답 다시 풀기" : "문제 풀기"}
          </h1>
          <p className="text-sub text-[14px]">
            {mode === "wrong"
              ? `${wrongAll ? "모든 선생님의 오답을 한 번에 모았어요. " : "틀렸던 문제만 모았어요. "}맞히면 극복한 오답으로 기록돼요.`
              : "선생님이 올린 자료로 만든 문제예요."}
          </p>
        </div>
        <Link href="/quiz/notes" className="chip shrink-0 !text-[13px]">
          오답노트
        </Link>
      </div>

      {/* PC에선 좌(컨트롤 레일 sticky) / 우(문제) 2단 — 모바일 기둥 방지 */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <div className="flex flex-col gap-4 lg:sticky lg:top-[76px]">
      {/* 연습문제 / 평가 탭 — 전체 오답 모드는 연습문제 오답만 다루므로 숨긴다 */}
      {!wrongAll && (
      <div className="rise d1 flex flex-wrap gap-1.5">
        <button
          onClick={() => setTab("practice")}
          className={`chip !text-[13px] ${tab === "practice" ? "chip-on" : ""}`}
        >
          연습문제
        </button>
        <button
          onClick={() => setTab("exam")}
          className={`chip !text-[13px] ${tab === "exam" ? "chip-on" : ""}`}
        >
          평가
        </button>
        <span className="self-center text-[12px] text-sub ml-1">
          {tab === "exam" ? "선생님이 올린 시험 · 1회만 응시" : "자료로 만든 연습문제"}
        </span>
      </div>
      )}

      {/* 시험/공부 모드 토글 (연습문제 전용) */}
      {tab === "practice" && (
      <div className="rise d1 flex flex-wrap gap-1.5">
        <button
          onClick={() => setStudy(false)}
          className={`chip !text-[13px] ${!study ? "chip-on" : ""}`}
        >
          시험 모드
        </button>
        <button
          onClick={() => setStudy(true)}
          className={`chip !text-[13px] ${study ? "chip-on" : ""}`}
        >
          공부 모드
        </button>
        <span className="self-center text-[12px] text-sub ml-1">
          {study ? "정답·풀이를 옆에 두고 익혀요" : "풀고 바로 채점해요"}
        </span>
      </div>
      )}

      {/* 선생님·강좌 선택 — 전체 오답 모드에선 선생님 구분 없이 풀므로 숨긴다 */}
      {!wrongAll && (
      <div className="rise d1 card p-4 flex flex-col gap-3">
        <div className="flex gap-1.5 overflow-x-auto lg:flex-wrap lg:overflow-visible">
          {teachers?.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTeacherId(t.id);
                setCourseId("");
              }}
              className={`chip shrink-0 !text-[13px] ${teacherId === t.id ? "chip-on" : ""}`}
            >
              {t.name}
            </button>
          ))}
        </div>
        {courses.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto lg:flex-wrap lg:overflow-visible">
            <button
              onClick={() => setCourseId("")}
              className={`chip shrink-0 !py-1 !px-2.5 !text-[12px] ${courseId === "" ? "chip-on" : ""}`}
            >
              전체
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => setCourseId(c.id)}
                className={`chip shrink-0 !py-1 !px-2.5 !text-[12px] ${courseId === c.id ? "chip-on" : ""}`}
              >
                {c.title}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
      </div>

      <div className="flex flex-col gap-4">
      {tab === "exam" && teacherId && (
        <AssessmentRunner token={session?.access_token} teacherId={teacherId} />
      )}

      {tab === "practice" && (
        <>
      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {qs === null && <div className="skel h-52 !rounded-[20px]" />}

      {/* 비로그인 오답모드 — 서버가 빈 목록 + needLogin을 주므로 안내로 받는다 */}
      {needLogin && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">로그인하면 오답노트를 쓸 수 있어요</p>
          <p className="text-sub text-[13px] mb-5">틀린 문제가 계정에 저장돼서 다시 풀 수 있어요.</p>
          <Link href="/login?role=student" className="btn btn-primary py-3 px-6 inline-block">
            학생 로그인
          </Link>
        </div>
      )}

      {qs?.length === 0 && !err && !needLogin && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">
            {mode === "wrong" ? "틀린 문제가 없어요" : "아직 만들어진 문제가 없어요"}
          </p>
          <p className="text-sub text-[13px]">
            {mode === "wrong"
              ? "문제를 풀다 틀리면 여기에 모여요."
              : "선생님이 자료로 문제를 만들면 여기에 나와요."}
          </p>
        </div>
      )}

      {/* 진행 상황 */}
      {qs && qs.length > 0 && !finished && (
        <div className="rise d2 flex items-center justify-between text-[13px] text-sub">
          <span>
            {idx + 1} / {qs.length}문제
          </span>
          {!study && (
            <span className="tabular-nums">
              맞은 개수 {score.right} / {score.done}
            </span>
          )}
        </div>
      )}

      {/* 공부 모드 — 문제 옆에 정답·풀이 (데스크톱 2단, 모바일 세로) */}
      {study && q && (
        <div key={q.id} className="animate-pop grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
          <div className="card p-5 lg:p-6 flex flex-col gap-4">
            <p className="text-[16px] font-bold leading-relaxed">{q.question}</p>
            <div className="flex flex-col gap-2">
              {q.choices.map((c, i) => {
                const isAnswer = q.answer === i;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-[14px] border border-line p-3.5"
                    style={isAnswer ? { borderColor: "var(--blue)", background: "var(--blue-weak)" } : {}}
                  >
                    <span className="shrink-0 grid place-items-center w-6 h-6 rounded-full border border-line text-[12px] font-extrabold">
                      {i + 1}
                    </span>
                    <span className="text-[14px] leading-relaxed">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card p-5 lg:p-6 flex flex-col gap-3 self-start lg:sticky lg:top-[76px]">
            <p className="text-[13px] font-extrabold text-blue">정답 {(q.answer ?? 0) + 1}번</p>
            <p className="text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
              {q.explanation || "이 문제는 해설이 없어요."}
            </p>
            <div className="flex gap-2 mt-1">
              <button onClick={() => studyGo(-1)} disabled={idx === 0} className="btn btn-gray flex-1 py-3 disabled:opacity-50">
                이전
              </button>
              <button
                onClick={() => studyGo(1)}
                disabled={idx >= qs!.length - 1}
                className="btn btn-primary flex-1 py-3 disabled:opacity-50"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 시험 모드 — 문제 */}
      {!study && q && !finished && (
        <div key={q.id} className="animate-pop card p-5 lg:p-6 flex flex-col gap-4">
          <p className="text-[16px] font-bold leading-relaxed">{q.question}</p>

          <div className="flex flex-col gap-2">
            {q.choices.map((c, i) => {
              const isPicked = picked === i;
              const isAnswer = graded?.answer === i;
              // 채점 전엔 선택만 표시, 채점 후엔 정답(파랑)·내 오답(빨강)을 함께 보여준다
              const style: React.CSSProperties = graded
                ? isAnswer
                  ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                  : isPicked
                    ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                    : {}
                : isPicked
                  ? { borderColor: "var(--blue)" }
                  : {};
              return (
                <button
                  key={i}
                  onClick={() => submit(i)}
                  disabled={Boolean(graded) || busy}
                  className="flex items-start gap-3 rounded-[14px] border border-line p-3.5 text-left transition-colors disabled:cursor-default hover:border-[var(--border-strong)]"
                  style={style}
                >
                  <span className="shrink-0 grid place-items-center w-6 h-6 rounded-full border border-line text-[12px] font-extrabold">
                    {i + 1}
                  </span>
                  <span className="text-[14px] leading-relaxed">{c}</span>
                </button>
              );
            })}
          </div>

          {graded && (
            <div className="animate-pop flex flex-col gap-2 pt-1">
              <p className="text-[15px] font-extrabold" style={{ color: graded.correct ? "var(--blue)" : "var(--red)" }}>
                {graded.correct ? "정답이에요" : "틀렸어요"}
              </p>
              {graded.explanation && (
                <p className="text-[14px] leading-relaxed rounded-[14px] p-3.5" style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}>
                  {graded.explanation}
                </p>
              )}
              {!session && (
                <p className="text-[12px] text-sub">
                  로그인하면 틀린 문제가 오답노트에 저장돼요.{" "}
                  <Link href="/login?role=student" className="text-blue font-bold">
                    로그인하기
                  </Link>
                </p>
              )}
              <button onClick={next} className="btn btn-primary py-3.5 mt-1">
                {idx + 1 === qs!.length ? "결과 보기" : "다음 문제"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 결과 */}
      {finished && (
        <div className="animate-pop card p-8 text-center flex flex-col gap-3">
          <p className="text-[15px] text-sub">오늘 푼 결과</p>
          <p className="text-[34px] font-extrabold tabular-nums">
            {score.right} <span className="text-[20px] text-sub">/ {score.done}</span>
          </p>
          {score.done > score.right && (
            <p className="text-[14px] text-sub">틀린 {score.done - score.right}문제는 오답노트에 담겼어요.</p>
          )}
          <div className="flex flex-col sm:flex-row gap-2 mt-2">
            <button onClick={load} className="btn btn-gray flex-1 py-3.5">
              다시 풀기
            </button>
            <Link href="/quiz/notes" className="btn btn-primary flex-1 py-3.5 text-center">
              오답노트 보기
            </Link>
          </div>
        </div>
      )}
        </>
      )}
      </div>
      </div>
    </main>
  );
}
