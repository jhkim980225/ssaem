"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";

type Note = {
  id: string;
  question: string;
  choices: string[];
  answer: number;
  explanation: string | null;
  chosen: number;
  teacherId: string;
  teacher: string;
  at: string;
  cleared: boolean; // 다시 풀어서 맞힘 (극복)
  wrongCount: number;
};
type Data = { totals: { attempted: number; wrong: number; correct: number; overcome: number }; notes: Note[] };

// 오답노트 — 한 번이라도 틀린 문제는 전부 기록. 다시 맞히면 '극복한 오답'으로 내려가고 기록은 남는다.
export default function NotesPage() {
  const { session, gate } = useGate("any", { loginMessage: "오답노트는 계정에 저장돼요." });
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/quiz/attempt", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setData(d.totals ? d : { totals: { attempted: 0, wrong: 0, correct: 0, overcome: 0 }, notes: [] }))
      .catch(() => setData({ totals: { attempted: 0, wrong: 0, correct: 0, overcome: 0 }, notes: [] }));
  }, [session]);

  if (gate) return gate;

  const remain = (data?.notes ?? []).filter((n) => !n.cleared);
  const overcome = (data?.notes ?? []).filter((n) => n.cleared);

  // 남은 오답이 여러 선생님에 걸치면 선생님별 다시 풀기도 준다. id로 묶어 동명이인 안전.
  const byTeacher = new Map<string, { name: string; n: number }>();
  for (const x of remain) {
    const cur = byTeacher.get(x.teacherId) ?? { name: x.teacher, n: 0 };
    cur.n++;
    byTeacher.set(x.teacherId, cur);
  }
  const groups = [...byTeacher.entries()];

  const noteCard = (n: Note, i: number) => (
    <div key={n.id} className={`rise d${Math.min(i + 2, 6)} card overflow-hidden`}>
      <button onClick={() => setOpen(open === n.id ? null : n.id)} className="w-full text-left p-4 lg:p-5 cursor-pointer">
        <div className="flex items-start justify-between gap-3">
          <p className="font-bold text-[15px] leading-relaxed">{n.question}</p>
          <span className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {n.cleared && (
              <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-full text-blue" style={{ background: "var(--blue-weak)" }}>
                극복
              </span>
            )}
            {n.wrongCount > 1 && (
              <span className="text-[11px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ color: "var(--red)", background: "var(--red-weak)" }}>
                {n.wrongCount}번 틀림
              </span>
            )}
            <span className="text-sub text-[12px]">{n.teacher}</span>
          </span>
        </div>
      </button>

      {open === n.id && (
        <div className="px-4 lg:px-5 pb-4 border-t border-line pt-3 flex flex-col gap-2">
          {n.choices.map((c, ci) => {
            const isAnswer = ci === n.answer;
            const isMine = ci === n.chosen;
            return (
              <div
                key={ci}
                className="flex items-start gap-2.5 rounded-[12px] border border-line p-3 text-[14px] leading-relaxed"
                style={
                  isAnswer
                    ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                    : isMine
                      ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                      : {}
                }
              >
                <span className="shrink-0 grid place-items-center w-5 h-5 rounded-full border border-line text-[11px] font-extrabold">
                  {ci + 1}
                </span>
                <span className="flex-1">{c}</span>
                {isAnswer && <span className="text-[11px] font-extrabold text-blue shrink-0">정답</span>}
                {isMine && !isAnswer && (
                  <span className="text-[11px] font-extrabold shrink-0" style={{ color: "var(--red)" }}>
                    내 답
                  </span>
                )}
              </div>
            );
          })}
          {n.explanation && (
            <p className="text-[14px] leading-relaxed rounded-[12px] p-3.5 mt-1" style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}>
              {n.explanation}
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-4xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <BackButton fallback="/quiz" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">오답노트</h1>
          <p className="text-sub text-[14px]">틀렸던 문제는 전부 기록돼요. 다시 맞히면 극복한 오답으로 내려가요.</p>
        </div>
        <Link href="/quiz" className="chip shrink-0 !text-[13px]">
          문제 풀기
        </Link>
      </div>

      {data === null && <div className="skel h-24 !rounded-[20px]" />}

      {data && (
        // PC에선 좌(요약·다시 풀기 sticky) / 우(오답 목록) 2단 — 모바일 기둥 방지
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-4 lg:sticky lg:top-[76px]">
          <div className="rise d1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-2">
            {(
              [
                ["푼 문제", data.totals.attempted, false],
                ["맞은 문제", data.totals.correct, false],
                ["남은 오답", data.totals.wrong, true],
                ["극복한 오답", data.totals.overcome, false],
              ] as const
            ).map(([label, n, warn]) => (
              <div key={label} className="card p-4 text-center">
                <p
                  className="text-[24px] font-extrabold tabular-nums"
                  style={warn && n > 0 ? { color: "var(--red)" } : label === "극복한 오답" && n > 0 ? { color: "var(--blue)" } : undefined}
                >
                  {n}
                </p>
                <p className="text-[12px] text-sub mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {remain.length > 0 && (
            <div className="rise d2 flex flex-col gap-2">
              <Link href="/quiz?mode=wrong" className="btn btn-primary py-4 text-center">
                오답 전체 다시 풀기 ({remain.length}문제)
              </Link>
              {groups.length > 1 &&
                groups.map(([tid, g]) => (
                  <Link key={tid} href={`/quiz?mode=wrong&teacher=${tid}`} className="btn btn-gray py-3 text-center">
                    {g.name} 오답만 다시 풀기 ({g.n}문제)
                  </Link>
                ))}
            </div>
          )}
          </div>

          <div className="flex flex-col gap-4">
          {data.notes.length === 0 && (
            <div className="rise d2 card p-10 text-center">
              <p className="text-[15px] font-bold mb-1">틀린 문제가 없어요</p>
              <p className="text-sub text-[13px]">
                {data.totals.attempted === 0 ? "문제를 풀면 틀린 것만 여기에 모여요." : "지금까지 푼 문제를 모두 맞혔어요."}
              </p>
            </div>
          )}

          {data.notes.length > 0 && remain.length === 0 && (
            <div className="rise d2 card p-6 text-center">
              <p className="text-[15px] font-bold mb-1">남은 오답이 없어요</p>
              <p className="text-sub text-[13px]">틀렸던 문제를 전부 극복했어요. 기록은 아래에 그대로 남아 있어요.</p>
            </div>
          )}

          <div className="flex flex-col gap-2">{remain.map(noteCard)}</div>

          {overcome.length > 0 && (
            <>
              <div className="rise d3 flex flex-col gap-0.5 mt-2">
                <h2 className="text-[16px] font-extrabold">극복한 오답 ({overcome.length})</h2>
                <p className="text-sub text-[13px]">틀렸다가 다시 풀어서 맞힌 문제예요. 시험 전에 한 번 더 봐두면 좋아요.</p>
              </div>
              <div className="flex flex-col gap-2">{overcome.map(noteCard)}</div>
            </>
          )}
          </div>
        </div>
      )}
    </main>
  );
}
