"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = { id: string; name: string; subject: string | null };
type Course = { id: string; title: string };
type Q = { id: string; question: string; choices: string[] };
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

  const [session, setSession] = useState<Session | null>(null);
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");

  const [qs, setQs] = useState<Q[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [graded, setGraded] = useState<Graded | null>(null);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    fetch("/api/teachers")
      .then((r) => r.json())
      .then((d) => {
        const list: Teacher[] = d.teachers ?? [];
        setTeachers(list);
        setTeacherId((cur) => cur || list[0]?.id || "");
      })
      .catch(() => setTeachers([]));
  }, []);

  useEffect(() => {
    if (!teacherId) return;
    fetch(`/api/courses?teacher=${teacherId}`)
      .then((r) => r.json())
      .then((d) => setCourses(d.courses ?? []))
      .catch(() => setCourses([]));
  }, [teacherId]);

  // 상태 초기화를 await 뒤로 모았다 — 이펙트 본문에서 동기 setState를 하면
  // 렌더가 연쇄로 돌아 react-hooks/set-state-in-effect에 걸린다.
  const load = useCallback(async () => {
    if (!teacherId) return;
    const r = await fetch(
      `/api/quiz?teacher=${teacherId}${courseId ? `&course=${courseId}` : ""}&mode=${mode}`,
      { headers: session ? { Authorization: `Bearer ${session.access_token}` } : {} }
    );
    const d = await r.json().catch(() => null);
    setIdx(0);
    setPicked(null);
    setGraded(null);
    setScore({ right: 0, done: 0 });
    if (!r.ok) {
      setErr(d?.error ?? "문제를 불러오지 못했어요.");
      setQs([]);
      return;
    }
    setErr("");
    setQs(d.questions ?? []);
  }, [teacherId, courseId, mode, session]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load의 setState는 모두 await 이후라 동기 캐스케이드 아님
    load();
  }, [load]);

  async function submit(choice: number) {
    if (graded || busy || !qs) return;
    setPicked(choice);
    setBusy(true);
    const r = await fetch("/api/quiz/attempt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ questionId: qs[idx].id, chosen: choice }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) return setErr(d?.error ?? "채점하지 못했어요.");
    setGraded(d);
    setScore((s) => ({ right: s.right + (d.correct ? 1 : 0), done: s.done + 1 }));
  }

  function next() {
    setPicked(null);
    setGraded(null);
    setIdx((i) => i + 1);
  }

  const q = qs?.[idx];
  const finished = qs !== null && qs.length > 0 && idx >= qs.length;

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">
            {mode === "wrong" ? "오답 다시 풀기" : "문제 풀기"}
          </h1>
          <p className="text-sub text-[14px]">
            {mode === "wrong"
              ? "틀렸던 문제만 모았어요. 맞히면 오답노트에서 빠져요."
              : "선생님이 올린 자료로 만든 문제예요."}
          </p>
        </div>
        <Link href="/quiz/notes" className="chip shrink-0 !text-[13px]">
          오답노트
        </Link>
      </div>

      {/* 선생님·강좌 선택 */}
      <div className="rise d1 card p-4 flex flex-col gap-3">
        <div className="flex gap-1.5 overflow-x-auto">
          {teachers?.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTeacherId(t.id);
                setCourseId("");
              }}
              className={`chip shrink-0 !text-[13px] ${teacherId === t.id ? "chip-on" : ""}`}
            >
              {avatarEmoji(t.name)} {t.name}
            </button>
          ))}
        </div>
        {courses.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto">
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

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {qs === null && <div className="skel h-52 !rounded-[20px]" />}

      {qs?.length === 0 && !err && (
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
          <span className="tabular-nums">
            맞은 개수 {score.right} / {score.done}
          </span>
        </div>
      )}

      {/* 문제 */}
      {q && !finished && (
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
    </main>
  );
}
