"use client";
import { useMemo, useState } from "react";

// 기출 CBT 모드 — 실제 시험처럼 푼다.
//  · 상단 번호판으로 아무 문항이나 바로 이동 (푼 문제는 색이 찬다)
//  · 한 문제씩 보며 답만 체크하고, 마지막에 **한 번에 채점**
//  · 채점 후 문항별 정오·해설을 번호판에서 오가며 확인
//
// 즉시채점(기존 방식)과 달리 중간에 답을 바꿀 수 있다 — 시험이니까.

export type CbtQuestion = { id: string; type: "theory"; stem: string; choices: string[]; area: string; typeTag: string };
type Graded = { questionId: string; chosen: number; correct: boolean; answerIdx: number; explanation: string };

// stem에서 첨부 서식([[서식]]) 분리 — 행 정렬이 생명이라 가로 스크롤 박스로
function splitStem(stem: string): { body: string; form: string | null } {
  const parts = stem.split("\n[[서식]]\n");
  return parts.length > 1 ? { body: parts[0], form: parts.slice(1).join("\n") } : { body: stem, form: null };
}

export default function CbtRunner({
  token,
  questions,
  title,
  onExit,
}: {
  token: string | undefined;
  questions: CbtQuestion[];
  title: string;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const gradedBy = useMemo(() => {
    const m = new Map<string, Graded>();
    for (const g of graded ?? []) m.set(g.questionId, g);
    return m;
  }, [graded]);

  const answered = Object.keys(picked).length;
  const q = questions[idx];
  const g = q ? gradedBy.get(q.id) : undefined;
  const score = (graded ?? []).filter((r) => r.correct).length;

  async function submit() {
    if (busy || !token) return;
    const unanswered = questions.length - answered;
    if (unanswered > 0 && !confirm(`아직 ${unanswered}문항이 비어 있어요. 채점할까요?`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/bank/attempt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: Object.entries(picked).map(([questionId, chosen]) => ({ questionId, chosen })),
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error ?? "채점하지 못했어요.");
        return;
      }
      setGraded(d.results ?? []);
      setIdx(0);
    } catch {
      setErr("채점하지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!q) return null;
  const { body, form } = splitStem(q.stem);

  return (
    <div className="flex flex-col gap-4">
      {/* 머리말 + 진행 */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[18px] font-extrabold truncate">{title}</h2>
          <p className="text-sub text-[13px]">
            {graded
              ? `채점 완료 · ${score} / ${graded.length}점 (정답률 ${graded.length ? Math.round((score / graded.length) * 100) : 0}%)`
              : `${questions.length}문항 · ${answered}개 풀었어요`}
          </p>
        </div>
        <button onClick={onExit} className="chip !text-[13px] shrink-0">
          나가기
        </button>
      </div>

      {/* 번호판 — 푼 문제·정오를 한눈에 */}
      <div className="card p-3">
        <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5">
          {questions.map((item, i) => {
            const gi = gradedBy.get(item.id);
            const done = picked[item.id] !== undefined;
            const style: React.CSSProperties = gi
              ? gi.correct
                ? { background: "var(--blue)", color: "#fff", borderColor: "transparent" }
                : { background: "var(--red)", color: "#fff", borderColor: "transparent" }
              : done
                ? { background: "var(--blue-weak)", color: "var(--blue)", borderColor: "var(--blue)" }
                : {};
            return (
              <button
                key={item.id}
                onClick={() => setIdx(i)}
                style={style}
                className={`h-9 rounded-[10px] border border-line text-[13px] font-bold tabular-nums transition-colors ${
                  i === idx ? "ring-2 ring-[var(--blue)] ring-offset-1" : ""
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* 문제 */}
      <div key={q.id} className="animate-pop card p-5 lg:p-6 flex flex-col gap-4">
        <div className="flex gap-1.5 flex-wrap">
          <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{idx + 1}번</span>
          <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{q.typeTag}</span>
          <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{q.area}</span>
        </div>

        <p className="text-[16px] font-bold leading-relaxed whitespace-pre-wrap">{body}</p>
        {form && (
          <pre
            className="text-[12px] leading-snug overflow-x-auto rounded-[12px] border border-line p-3"
            style={{ background: "var(--fill-2)" }}
          >
            {form}
          </pre>
        )}

        <div className="flex flex-col gap-2">
          {q.choices.map((c, ci) => {
            const mine = picked[q.id] === ci;
            const style: React.CSSProperties = g
              ? ci === g.answerIdx
                ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                : mine
                  ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                  : {}
              : mine
                ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                : {};
            return (
              <button
                key={ci}
                onClick={() => !graded && setPicked((p) => ({ ...p, [q.id]: ci }))}
                disabled={Boolean(graded)}
                style={style}
                className="text-left rounded-[14px] border border-line px-4 py-3 text-[14px] leading-relaxed flex items-start gap-2.5 transition-colors disabled:cursor-default hover:border-[var(--blue)]"
              >
                <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                  {ci + 1}
                </span>
                <span className="flex-1">{c}</span>
                {g && ci === g.answerIdx && <span className="text-[11px] font-bold text-blue shrink-0">정답</span>}
                {g && mine && ci !== g.answerIdx && (
                  <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--red)" }}>
                    내 답
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 채점 후 해설 */}
        {g && (
          <div className="animate-pop flex flex-col gap-2">
            <p className="text-[14px] font-extrabold" style={{ color: g.correct ? "var(--blue)" : "var(--red)" }}>
              {g.correct ? "정답이에요" : `틀렸어요 — 정답은 ${g.answerIdx + 1}번`}
            </p>
            {g.explanation && (
              <p
                className="text-[13px] leading-relaxed whitespace-pre-wrap rounded-[14px] p-3.5"
                style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}
              >
                {g.explanation}
              </p>
            )}
          </div>
        )}

        {/* 이동 */}
        <div className="flex gap-2">
          <button
            onClick={() => setIdx((i) => Math.max(i - 1, 0))}
            disabled={idx === 0}
            className="btn btn-gray flex-1 py-3 disabled:opacity-50"
          >
            이전
          </button>
          <button
            onClick={() => setIdx((i) => Math.min(i + 1, questions.length - 1))}
            disabled={idx >= questions.length - 1}
            className="btn btn-gray flex-1 py-3 disabled:opacity-50"
          >
            다음
          </button>
        </div>
      </div>

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {/* 채점 / 결과 */}
      {!graded ? (
        <button onClick={submit} disabled={busy} className="btn btn-primary py-4 disabled:opacity-60">
          {busy ? "채점 중…" : `채점하기 (${answered}/${questions.length})`}
        </button>
      ) : (
        <div className="card p-6 text-center flex flex-col gap-2">
          <p className="text-[13px] text-sub">{graded.length}문제 중</p>
          <p className="text-[36px] font-extrabold tabular-nums">
            {score}
            <span className="text-[18px] text-sub"> / {graded.length}</span>
          </p>
          <p className="text-sub text-[13px]">
            번호판에서 문제를 눌러 해설을 볼 수 있어요. 틀린 문제는 오답노트에 담겼어요.
          </p>
          <button onClick={onExit} className="btn btn-primary py-3 mt-1">
            다른 문제 풀기
          </button>
        </div>
      )}
    </div>
  );
}
