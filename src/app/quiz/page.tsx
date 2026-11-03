"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import AssessmentRunner from "@/components/AssessmentRunner";

type Teacher = { id: string; name: string; subject: string | null };
type Course = { id: string; title: string };
// 공부 모드일 때만 answer·explanation가 함께 온다
type Q = { id: string; question: string; choices: string[]; answer?: number; explanation?: string };
type Graded = { correct: boolean; answer: number; explanation: string };
// 결과 화면의 틀린 문항 목록 — 채점 응답(정답 번호)을 그때그때 모아 둔다 (API 추가 없이)
type Wrong = { n: number; question: string; chosen: number; answer: number };

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
  const [wrongs, setWrongs] = useState<Wrong[]>([]);
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
    setWrongs([]);
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
      if (!d.correct)
        setWrongs((w) => [...w, { n: idx + 1, question: qs[idx].question, chosen: choice, answer: d.answer }]);
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

  // 진행 바 — 시험·공부 모드 공통으로 문제 카드 맨 위에 붙는다
  const progress = qs && qs.length > 0 && (
    <div className="mb-5">
      <div className="flex items-center justify-between text-[14px] mb-2.5">
        <span className="font-bold text-blue tabular-nums">
          {idx + 1} / {qs.length}문제
        </span>
        {!study && (
          <span className="text-sub tabular-nums">
            맞은 개수 {score.right} / {score.done}
          </span>
        )}
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--fill)" }}>
        <div
          className="h-full rounded-full bg-blue transition-[width] duration-300"
          style={{ width: `${Math.min(((idx + 1) / qs.length) * 100, 100)}%` }}
        />
      </div>
    </div>
  );

  const rate = score.done ? Math.round((score.right / score.done) * 100) : 0;
  const scroller = "flex gap-1.5 overflow-x-auto [scrollbar-width:none] -mx-4 px-4 sm:-mx-5 sm:px-5 lg:mx-0 lg:px-0 lg:flex-wrap lg:overflow-visible";

  return (
    <main className={`flex-1 w-full ${width} mx-auto px-4 sm:px-5 pt-3 pb-8 lg:py-8 flex flex-col gap-3 lg:gap-4`}>
      <div className="rise flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 min-h-12">
          <h1 className="text-[22px] lg:text-[28px] font-bold">{mode === "wrong" ? "오답 다시 풀기" : "문제풀이"}</h1>
          <Link href="/quiz/notes" className="chip shrink-0 h-9 !py-0 flex items-center !font-bold text-text">
            오답노트
          </Link>
        </div>
        {mode === "wrong" && (
          <p className="text-sub text-[14px]">
            {wrongAll ? "모든 선생님의 오답을 한 번에 모았어요. " : "틀렸던 문제만 모았어요. "}맞히면 극복한 오답으로 기록돼요.
          </p>
        )}
      </div>

      {/* PC에선 좌(컨트롤 레일 sticky) / 우(문제) 2단 — 모바일 기둥 방지 */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <div className="flex flex-col gap-3 lg:sticky lg:top-[76px]">
      {/* 연습문제 / 평가 탭 — 전체 오답 모드는 연습문제 오답만 다루므로 숨긴다 */}
      {!wrongAll && (
        <Segment
          label="문제 종류"
          value={tab}
          onChange={setTab}
          items={[
            ["practice", "연습문제"],
            ["exam", "평가"],
          ]}
        />
      )}

      {/* 선생님·강좌 선택 — 폰은 가로 스크롤 칩 줄, PC는 레일 카드. 전체 오답 모드에선 숨긴다 */}
      {!wrongAll && (
      <div className="rise d1 flex flex-col gap-2 lg-card lg:p-4">
        <div className={scroller}>
          {teachers?.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTeacherId(t.id);
                setCourseId("");
              }}
              className={`chip shrink-0 h-9 !py-0 flex items-center whitespace-nowrap ${teacherId === t.id ? "chip-on !font-bold" : ""}`}
            >
              {t.name}
            </button>
          ))}
        </div>
        {courses.length > 0 && (
          <div className={scroller}>
            <button
              onClick={() => setCourseId("")}
              className={`chip shrink-0 h-8 !py-0 !px-3 !text-[13px] flex items-center whitespace-nowrap ${courseId === "" ? "chip-on" : ""}`}
            >
              전체
            </button>
            {courses.map((c) => (
              <button
                key={c.id}
                onClick={() => setCourseId(c.id)}
                className={`chip shrink-0 h-8 !py-0 !px-3 !text-[13px] flex items-center whitespace-nowrap ${courseId === c.id ? "chip-on" : ""}`}
              >
                {c.title}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* 시험/공부 모드 토글 (연습문제 전용) */}
      {tab === "practice" && (
        <Segment
          label="풀이 모드"
          value={study ? "study" : "exam"}
          onChange={(v) => setStudy(v === "study")}
          items={[
            ["exam", "시험 모드 · 풀고 채점"],
            ["study", "공부 모드 · 답 보며"],
          ]}
        />
      )}

      {tab === "exam" && (
        <p className="px-1 text-[14px] text-sub">선생님이 올린 시험이에요 · 1회만 응시할 수 있어요</p>
      )}
      </div>

      <div className="flex flex-col gap-3 lg:gap-4">
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

      {qs === null && <div className="skel h-72 !rounded-[16px]" />}

      {/* 비로그인 오답모드 — 서버가 빈 목록 + needLogin을 주므로 안내로 받는다 */}
      {needLogin && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[16px] font-bold mb-1">로그인하면 오답노트를 쓸 수 있어요</p>
          <p className="text-sub text-[14px] mb-5">틀린 문제가 계정에 저장돼서 다시 풀 수 있어요.</p>
          <Link href="/login?role=student" className="btn btn-primary h-12 px-6 inline-flex items-center">
            학생 로그인
          </Link>
        </div>
      )}

      {qs?.length === 0 && !err && !needLogin && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[16px] font-bold mb-1">
            {mode === "wrong" ? "틀린 문제가 없어요" : "아직 만들어진 문제가 없어요"}
          </p>
          <p className="text-sub text-[14px]">
            {mode === "wrong"
              ? "문제를 풀다 틀리면 여기에 모여요."
              : "선생님이 자료로 문제를 만들면 여기에 나와요."}
          </p>
        </div>
      )}

      {/* 공부 모드 — 문제 옆에 정답·풀이 (데스크톱 2단, 모바일 세로) */}
      {study && q && (
        <div key={q.id} className="animate-pop grid gap-3 lg:gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
          <div className="card p-5 lg:p-6 flex flex-col">
            {progress}
            <p className="text-[17px] font-bold leading-relaxed mb-4 break-keep">{q.question}</p>
            <div className="flex flex-col gap-2">
              {q.choices.map((c, i) => {
                const isAnswer = q.answer === i;
                return (
                  <div key={i} className={CHOICE} style={isAnswer ? RIGHT : NEUTRAL}>
                    <ChoiceBody n={i + 1} text={c} mark={isAnswer ? "right" : null} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-3 self-start w-full lg:sticky lg:top-[76px]">
            <div className="card p-5 lg:p-6">
              <p className="text-[15px] font-bold text-green mb-2">정답 {(q.answer ?? 0) + 1}번</p>
              <p className="text-[15px] leading-relaxed break-keep" style={{ color: "var(--text-2)" }}>
                {q.explanation || "이 문제는 해설이 없어요."}
              </p>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <button onClick={() => studyGo(-1)} disabled={idx === 0} className="btn btn-gray h-[50px] text-[17px]">
                이전
              </button>
              <button
                onClick={() => studyGo(1)}
                disabled={idx >= qs!.length - 1}
                className="btn btn-primary h-[50px] text-[17px]"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 시험 모드 — 문제 */}
      {!study && q && !finished && (
        <>
        <div key={q.id} className="animate-pop card p-5 lg:p-6 flex flex-col">
          {progress}
          <p className="text-[17px] font-bold leading-relaxed mb-4 break-keep">{q.question}</p>

          <div className="flex flex-col gap-2">
            {q.choices.map((c, i) => {
              const isPicked = picked === i;
              const isAnswer = graded?.answer === i;
              // 채점 전엔 선택만 표시, 채점 후엔 정답·내 오답을 함께 보여준다
              const mark = graded ? (isAnswer ? "right" : isPicked ? "wrong" : null) : null;
              const style = mark === "right" ? RIGHT : mark === "wrong" ? WRONG : isPicked ? PICKED : NEUTRAL;
              return (
                <button
                  key={i}
                  onClick={() => submit(i)}
                  disabled={Boolean(graded) || busy}
                  className={`${CHOICE} disabled:cursor-default enabled:hover:brightness-[0.97]`}
                  style={style}
                >
                  <ChoiceBody n={i + 1} text={c} mark={mark} />
                </button>
              );
            })}
          </div>

          {graded && (
            <div
              className="animate-pop mt-4 rounded-[12px] p-4 flex flex-col gap-1.5"
              style={{ background: graded.correct ? "var(--green-weak)" : "var(--red-weak)" }}
            >
              <p className="text-[16px] font-bold" style={{ color: graded.correct ? "var(--green)" : "var(--red)" }}>
                {graded.correct ? "정답이에요" : "틀렸어요"}
              </p>
              {graded.explanation && (
                <p className="text-[14px] leading-relaxed break-keep" style={{ color: "var(--text-2)" }}>
                  {graded.explanation}
                </p>
              )}
            </div>
          )}
          {graded && !session && (
            <p className="text-[13px] text-sub mt-3">
              로그인하면 틀린 문제가 오답노트에 저장돼요.{" "}
              <Link href="/login?role=student" className="text-blue font-bold">
                로그인하기
              </Link>
            </p>
          )}
        </div>
        {graded && (
          <button onClick={next} className="animate-pop btn btn-primary w-full h-[50px] text-[17px]">
            {idx + 1 === qs!.length ? "결과 보기" : "다음 문제"}
          </button>
        )}
        </>
      )}

      {/* 결과 — 원형 정답률 */}
      {finished && (
        <div className="animate-pop card px-6 py-8 lg:p-10 flex flex-col items-center text-center">
          <div
            role="img"
            aria-label={`정답률 ${rate}%`}
            className="w-[168px] h-[168px] rounded-full grid place-items-center"
            style={{ background: `conic-gradient(var(--blue) 0 ${rate}%, var(--blue-weak) ${rate}% 100%)` }}
          >
            <div className="w-[136px] h-[136px] rounded-full bg-surface flex flex-col items-center justify-center">
              <span className="text-[38px] font-bold tabular-nums tracking-tight leading-tight">
                {score.right}
                <span className="text-[22px] text-sub"> / {score.done}</span>
              </span>
              <span className="text-[13px] text-sub">정답률 {rate}%</span>
            </div>
          </div>
          <p className="mt-7 mb-1.5 text-[14px] font-bold text-blue">오늘 푼 결과</p>
          <h2 className="text-[22px] lg:text-[24px] font-bold mb-2">
            {rate === 100
              ? "모두 맞혔어요!"
              : rate >= 80
                ? "잘했어요! 거의 다 맞혔어요"
                : rate >= 50
                  ? "좋아요, 조금만 더 해봐요"
                  : "오답노트로 다시 익혀봐요"}
          </h2>
          {score.done > score.right && (
            <p className="text-[15px] text-sub leading-relaxed">
              틀린 {score.done - score.right}문제는 오답노트에 담겼어요.
              <br />
              다시 맞히면 극복한 오답으로 내려가요.
            </p>
          )}
          {wrongs.length > 0 && (
            <ul aria-label="틀린 문항" className="mt-6 w-full flex flex-col gap-2 text-left">
              {wrongs.map((w) => (
                <li key={w.n} className="rounded-[10px] px-4 py-3.5 text-[14px]" style={{ background: "var(--red-weak)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 line-clamp-2 break-keep">
                      <b className="tabular-nums">{w.n}번</b> · {w.question}
                    </span>
                    <b className="shrink-0" style={{ color: "var(--red)" }}>
                      오답
                    </b>
                  </div>
                  <p className="mt-1 text-[13px] tabular-nums" style={{ color: "var(--sub-2)" }}>
                    내 답 <b style={{ color: "var(--red)" }}>{w.chosen + 1}번</b> · 정답{" "}
                    <b style={{ color: "var(--green)" }}>{w.answer + 1}번</b>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2 w-full mt-6">
            <Link href="/quiz/notes" className="btn btn-ghost h-[50px] text-[16px] flex items-center justify-center">
              오답노트 보기
            </Link>
            <button onClick={load} className="btn btn-primary h-[50px] text-[16px]">
              다시 풀기
            </button>
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

// 2칸 세그먼트 (연습문제/평가, 시험/공부 모드) — 회색 트랙 + 흰 선택칸
function Segment<T extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: T;
  items: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="rise d1 grid grid-cols-2 gap-1 p-1 rounded-[10px]" style={{ background: "var(--fill)" }}>
      {items.map(([v, text]) => (
        <button
          key={v}
          role="tab"
          aria-selected={value === v}
          onClick={() => onChange(v)}
          className={`h-10 rounded-[8px] px-2 text-[14px] truncate transition-colors ${
            value === v ? "bg-surface font-bold text-text shadow-[var(--shadow-card)]" : "font-semibold text-[var(--sub-2)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

// 보기 — 큰 터치 영역의 둥근 사각. 정답(초록)·내 오답(빨강)은 배경+안쪽 테두리로 구분
const CHOICE = "w-full min-h-[52px] rounded-[12px] px-4 py-3 flex items-center gap-3 text-left text-[15px] leading-relaxed transition-[filter,box-shadow]";
const NEUTRAL: React.CSSProperties = { background: "var(--fill-2)", boxShadow: "inset 0 0 0 1px var(--border)" };
const PICKED: React.CSSProperties = { background: "var(--fill-2)", boxShadow: "inset 0 0 0 1px var(--blue)" };
const RIGHT: React.CSSProperties = {
  background: "var(--green-weak)",
  boxShadow: "inset 0 0 0 1px var(--green)",
  color: "var(--green)",
  fontWeight: 700,
};
const WRONG: React.CSSProperties = {
  background: "var(--red-weak)",
  boxShadow: "inset 0 0 0 1px var(--red)",
  color: "var(--red)",
  fontWeight: 700,
};

function ChoiceBody({ n, text, mark }: { n: number; text: string; mark: "right" | "wrong" | null }) {
  return (
    <>
      <b className="shrink-0 w-4 text-center" style={mark ? undefined : { color: "var(--sub)" }}>
        {n}
      </b>
      <span className="flex-1 min-w-0 break-keep">{text}</span>
      {mark && (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d={mark === "right" ? "M5 12.5l4.5 4.5L19 7.5" : "M6 6l12 12M18 6L6 18"} />
        </svg>
      )}
    </>
  );
}
