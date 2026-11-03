"use client";
import { useCallback, useEffect, useState } from "react";
import SignaturePad from "@/components/SignaturePad";

// 학생 평가 응시. 목록 → 응시(전 문항 한 화면) → 서명 → 제출 → 결과.
//
// 연습문제(quiz)와 다른 점:
//  - 문항별 즉시 채점이 아니라 **한 번에 제출**한다 (시험이므로 되돌아보며 고칠 수 있어야 함)
//  - **1인 1회**. 서버가 unique 제약으로 강제하고, 화면은 이미 응시한 평가를 잠근다
//  - 제출 전 **전자서명**으로 본인 확인을 남긴다

type Item = {
  id: string;
  title: string;
  questions: number;
  done: boolean;
  score: number | null;
  total: number | null;
};
type Q = { id: string; question: string; choices: string[] };
type ResultRow = {
  questionId: string;
  question: string;
  choices: string[];
  chosen: number;
  answer: number;
  correct: boolean;
  explanation: string;
};
type Result = { score: number; total: number; results: ResultRow[]; signedAt: string | null };

export default function AssessmentRunner({
  token,
  teacherId,
}: {
  token: string | undefined;
  teacherId: string;
}) {
  const [list, setList] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");

  // 응시 중 상태
  const [open, setOpen] = useState<{ id: string; title: string; qs: Q[] } | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [sig, setSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const load = useCallback(async () => {
    if (!token || !teacherId) return;
    try {
      const r = await fetch(`/api/assessments?teacher=${teacherId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error ?? "평가를 불러오지 못했어요.");
        setList([]);
        return;
      }
      setErr("");
      setList(d.assessments ?? []);
    } catch {
      setErr("평가를 불러오지 못했어요 — 네트워크를 확인해 주세요.");
      setList([]);
    }
  }, [token, teacherId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState는 모두 await 이후
    load();
  }, [load]);

  async function start(item: Item) {
    if (!token) return;
    setErr("");
    setResult(null);
    try {
      const r = await fetch(`/api/assessments/${item.id}/questions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error ?? "문항을 불러오지 못했어요.");
        if (d?.done) load(); // 이미 응시 → 목록 갱신해 잠금 표시
        return;
      }
      setPicked({});
      setSig(null);
      setOpen({ id: item.id, title: d.title ?? item.title, qs: d.questions ?? [] });
    } catch {
      setErr("문항을 불러오지 못했어요 — 네트워크를 확인해 주세요.");
    }
  }

  async function submit() {
    if (!open || !token || busy) return;
    const unanswered = open.qs.length - Object.keys(picked).length;
    if (unanswered > 0 && !confirm(`아직 ${unanswered}문항을 안 풀었어요. 그대로 제출할까요?`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/assessments/${open.id}/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: Object.entries(picked).map(([questionId, chosen]) => ({ questionId, chosen })),
          signature: sig,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error ?? "제출하지 못했어요.");
        if (d?.done) {
          setOpen(null);
          load();
        }
        return;
      }
      setResult({ score: d.score, total: d.total, results: d.results ?? [], signedAt: d.signedAt });
      setOpen(null);
      load();
    } catch {
      setErr("제출하지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  // ── 결과
  if (result) {
    const rate = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="animate-pop flex flex-col gap-3">
        <div className="card px-5 py-7 text-center flex flex-col items-center">
          <span className={TAG} style={TAG_BLUE}>
            제출 완료{result.signedAt ? " · 서명 완료" : ""}
          </span>
          <p className="mt-4 text-[44px] font-bold tabular-nums tracking-tight leading-none text-blue">
            {result.score}
            <span className="text-[22px] text-sub"> / {result.total}</span>
          </p>
          <p className="mt-3 text-[15px]" style={{ color: "var(--sub-2)" }}>
            {result.total}문항 중 {result.score}문항
            {result.total > 0 ? ` · 정답률 ${rate}%` : ""}
          </p>
        </div>

        <h3 className="mt-2 px-1 text-[17px] font-bold">문항별 확인</h3>
        {/* 틀린 문항은 펼쳐서, 맞힌 문항은 한 줄로 접어 둔다 (눌러서 펼치기) */}
        {result.results.map((r, i) =>
          r.correct ? (
            <details key={r.questionId} className="card group">
              <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer px-5 py-4 flex items-center gap-2.5">
                <b className="shrink-0 text-[15px]">{i + 1}번</b>
                <span className={TAG} style={TAG_GREEN}>
                  정답
                </span>
                <span className="flex-1 min-w-0 truncate text-[14px]" style={{ color: "var(--sub-2)" }}>
                  {r.question}
                </span>
                <Chevron />
              </summary>
              <div className="px-5 pb-5">
                <ResultBody r={r} />
              </div>
            </details>
          ) : (
            <div key={r.questionId} className="card p-5">
              <div className="flex items-center gap-2 mb-2.5">
                <b className="text-[15px]">{i + 1}번</b>
                <span className={TAG} style={TAG_RED}>
                  오답
                </span>
              </div>
              <ResultBody r={r} />
            </div>
          )
        )}

        <button onClick={() => setResult(null)} className="btn btn-primary w-full h-[50px] text-[17px] mt-1">
          평가 목록으로
        </button>
      </div>
    );
  }

  // ── 응시 중
  if (open) {
    return (
      <div className="animate-pop flex flex-col gap-3">
        <div className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center min-h-12">
          <button
            onClick={() => setOpen(null)}
            className="justify-self-start h-9 px-3 -ml-2 rounded-[8px] text-[15px] font-semibold transition-colors hover:bg-[var(--fill)]"
            style={{ color: "var(--sub-2)" }}
          >
            나가기
          </button>
          <h2 className="text-[16px] lg:text-[18px] font-bold text-center truncate">{open.title}</h2>
        </div>

        <p className="rounded-[12px] px-4 py-3.5 text-[14px] leading-relaxed" style={{ background: "var(--fill)", color: "var(--text-2)" }}>
          <b>{open.qs.length}문항</b> · 제출하면 다시 응시할 수 없어요. 모든 문항이 한 페이지에 있어요.
        </p>

        {open.qs.map((q, i) => (
          <div key={q.id} className="card p-5 flex flex-col gap-3.5">
            <p className="text-[16px] font-bold leading-relaxed break-keep">
              <span className="text-blue">{i + 1}.</span> {q.question}
            </p>
            <div className="flex flex-col gap-2">
              {q.choices.map((c, ci) => {
                const on = picked[q.id] === ci;
                return (
                  <button
                    key={ci}
                    onClick={() => setPicked((p) => ({ ...p, [q.id]: ci }))}
                    aria-pressed={on}
                    className="w-full min-h-12 rounded-[12px] px-4 py-3 flex items-center gap-3 text-left text-[15px] leading-relaxed transition-[filter,box-shadow] hover:brightness-[0.97]"
                    style={on ? ON : OFF}
                  >
                    <b className="shrink-0 w-4 text-center" style={on ? undefined : { color: "var(--sub)" }}>
                      {ci + 1}
                    </b>
                    <span className="flex-1 min-w-0 break-keep">{c}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div className="card p-5 flex flex-col gap-3">
          <div>
            <h3 className="text-[17px] font-bold mb-1">본인 확인 서명</h3>
            <p className="text-sub text-[14px]">본인이 직접 응시했다는 확인이에요. 서명 없이도 제출할 수 있어요.</p>
          </div>
          <SignaturePad onChange={setSig} disabled={busy} height={150} />
        </div>

        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}

        <button onClick={submit} disabled={busy} className="btn btn-primary w-full h-[50px] text-[17px]">
          {busy ? "제출 중…" : `제출하기 (${Object.keys(picked).length}/${open.qs.length}문항)`}
        </button>
      </div>
    );
  }

  // ── 목록
  return (
    <div className="flex flex-col gap-3">
      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
      {list === null && <div className="skel h-36 !rounded-[16px]" />}
      {list?.length === 0 && !err && (
        <div className="card p-10 text-center">
          <p className="text-[16px] font-bold mb-1">아직 등록된 평가가 없어요</p>
          <p className="text-sub text-[14px]">선생님이 평가를 올리면 여기에 나와요.</p>
        </div>
      )}
      {list?.map((a) => (
        <div key={a.id} className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[17px] font-bold truncate">{a.title}</p>
              <p className="mt-1 text-sub text-[13px]">
                {a.questions}문항
                {a.done && a.total !== null ? ` · 응시 완료 ${a.score}/${a.total}` : ""}
              </p>
            </div>
            <span className={TAG} style={a.done ? TAG_GRAY : TAG_BLUE}>
              {a.done ? "완료" : "응시 전"}
            </span>
          </div>
          {!a.done && (
            <button
              onClick={() => start(a)}
              disabled={a.questions === 0}
              className="btn btn-primary w-full h-12 mt-4 text-[15px]"
            >
              응시하기
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

const TAG = "inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold shrink-0 whitespace-nowrap";
const TAG_BLUE: React.CSSProperties = { background: "var(--blue-weak)", color: "var(--blue)" };
const TAG_GREEN: React.CSSProperties = { background: "var(--green-weak)", color: "var(--green)" };
const TAG_RED: React.CSSProperties = { background: "var(--red-weak)", color: "var(--red)" };
const TAG_GRAY: React.CSSProperties = { background: "var(--fill)", color: "var(--sub-2)" };

// 보기 — 응시 중 선택 표시
const OFF: React.CSSProperties = { background: "var(--fill-2)", boxShadow: "inset 0 0 0 1px var(--border)" };
const ON: React.CSSProperties = {
  background: "var(--blue-weak)",
  boxShadow: "inset 0 0 0 1px var(--blue)",
  color: "var(--blue)",
  fontWeight: 700,
};

function Chevron() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-sub transition-transform group-open:rotate-180" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// 결과 한 문항 — 지문 + 보기(정답·내 답 표시) + 해설
function ResultBody({ r }: { r: ResultRow }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] font-bold leading-relaxed break-keep">{r.question}</p>
      <div className="flex flex-col gap-1.5">
        {r.choices.map((c, ci) => {
          const isAnswer = ci === r.answer;
          const isMine = ci === r.chosen && !isAnswer;
          return (
            <div
              key={ci}
              className="flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[14px] leading-relaxed"
              style={
                isAnswer
                  ? { ...TAG_GREEN, fontWeight: 700 }
                  : isMine
                    ? { ...TAG_RED, fontWeight: 700 }
                    : { background: "var(--fill-2)" }
              }
            >
              <b className="shrink-0 w-4 text-center" style={isAnswer || isMine ? undefined : { color: "var(--sub)" }}>
                {ci + 1}
              </b>
              <span className="flex-1 min-w-0 break-keep">{c}</span>
              {isAnswer && <span className="text-[12px] shrink-0">정답</span>}
              {isMine && <span className="text-[12px] shrink-0">내 답</span>}
            </div>
          );
        })}
      </div>
      {r.explanation && (
        <p className="text-[14px] leading-relaxed rounded-[12px] p-3.5 break-keep" style={{ background: "var(--fill)", color: "var(--text-2)" }}>
          {r.explanation}
        </p>
      )}
    </div>
  );
}
