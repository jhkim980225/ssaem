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
    return (
      <div className="animate-pop flex flex-col gap-4">
        <div className="card p-8 text-center flex flex-col gap-2">
          <p className="text-[13px] text-sub">{result.total}문제 중</p>
          <p className="text-[40px] font-extrabold tabular-nums">
            {result.score}
            <span className="text-[20px] text-sub"> / {result.total}</span>
          </p>
          <p className="text-sub text-[14px]">
            {result.total > 0 ? `정답률 ${Math.round((result.score / result.total) * 100)}%` : ""}
            {result.signedAt ? " · 서명 완료" : ""}
          </p>
          <button onClick={() => setResult(null)} className="btn btn-gray py-3 mt-2">
            평가 목록으로
          </button>
        </div>
        {result.results.map((r, i) => (
          <div key={r.questionId} className="card p-5 flex flex-col gap-3">
            <p className="text-[15px] font-bold leading-relaxed">
              {i + 1}. {r.question}
            </p>
            <div className="flex flex-col gap-2">
              {r.choices.map((c, ci) => (
                <div
                  key={ci}
                  className="flex items-start gap-2.5 rounded-[14px] border border-line px-4 py-3 text-[14px]"
                  style={
                    ci === r.answer
                      ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                      : ci === r.chosen
                        ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                        : {}
                  }
                >
                  <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                    {ci + 1}
                  </span>
                  <span className="flex-1">{c}</span>
                  {ci === r.answer && <span className="text-[11px] font-bold text-blue shrink-0">정답</span>}
                  {ci === r.chosen && ci !== r.answer && (
                    <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--red)" }}>
                      내 답
                    </span>
                  )}
                </div>
              ))}
            </div>
            {r.explanation && (
              <p
                className="text-[13px] leading-relaxed rounded-[14px] p-3.5"
                style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}
              >
                {r.explanation}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }

  // ── 응시 중
  if (open) {
    return (
      <div className="animate-pop flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-extrabold">{open.title}</h2>
            <p className="text-sub text-[13px]">{open.qs.length}문항 · 제출하면 다시 응시할 수 없어요</p>
          </div>
          <button onClick={() => setOpen(null)} className="chip !text-[13px] shrink-0">
            나가기
          </button>
        </div>

        {open.qs.map((q, i) => (
          <div key={q.id} className="card p-5 flex flex-col gap-3">
            <p className="text-[15px] font-bold leading-relaxed">
              {i + 1}. {q.question}
            </p>
            <div className="flex flex-col gap-2">
              {q.choices.map((c, ci) => (
                <button
                  key={ci}
                  onClick={() => setPicked((p) => ({ ...p, [q.id]: ci }))}
                  className="text-left rounded-[14px] border border-line px-4 py-3 text-[14px] leading-relaxed flex items-start gap-2.5 transition-colors hover:border-[var(--blue)]"
                  style={picked[q.id] === ci ? { borderColor: "var(--blue)", background: "var(--blue-weak)" } : {}}
                >
                  <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                    {ci + 1}
                  </span>
                  <span>{c}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="card p-5 flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-bold">본인 확인 서명</p>
            <p className="text-sub text-[13px]">본인이 직접 응시했다는 확인이에요. 서명 없이도 제출할 수 있어요.</p>
          </div>
          <SignaturePad onChange={setSig} disabled={busy} />
        </div>

        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}

        <button onClick={submit} disabled={busy} className="btn btn-primary py-4 disabled:opacity-60">
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
      {list === null && <div className="skel h-32 !rounded-[20px]" />}
      {list?.length === 0 && !err && (
        <div className="card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 등록된 평가가 없어요</p>
          <p className="text-sub text-[13px]">선생님이 평가를 올리면 여기에 나와요.</p>
        </div>
      )}
      {list?.map((a) => (
        <div key={a.id} className="card p-5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold truncate">{a.title}</p>
            <p className="text-sub text-[13px]">
              {a.questions}문항
              {a.done && a.total !== null ? ` · 응시 완료 ${a.score}/${a.total}` : ""}
            </p>
          </div>
          {a.done ? (
            <span className="chip !text-[12px] !cursor-default shrink-0">완료</span>
          ) : (
            <button
              onClick={() => start(a)}
              disabled={a.questions === 0}
              className="btn btn-primary py-2.5 px-5 text-[14px] shrink-0 disabled:opacity-50"
            >
              응시하기
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
