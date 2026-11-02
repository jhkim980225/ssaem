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


  const noteCard = (n: Note, i: number) => {
    const isOpen = open === n.id;
    return (
      <div key={n.id} className={`rise d${Math.min(i + 2, 6)} card overflow-hidden`}>
        <button
          onClick={() => setOpen(isOpen ? null : n.id)}
          aria-expanded={isOpen}
          className="w-full text-left px-5 py-4 lg:py-[18px] flex items-center gap-3 cursor-pointer"
        >
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {n.cleared && (
                <span className={TAG} style={{ background: "var(--blue-weak)", color: "var(--blue)" }}>
                  극복
                </span>
              )}
              {n.wrongCount > 0 && (
                <span className={TAG} style={{ background: "var(--red-weak)", color: "var(--red)" }}>
                  {n.wrongCount}번 틀림
                </span>
              )}
              <span className={TAG} style={{ background: "var(--fill)", color: "var(--sub-2)", fontWeight: 600 }}>
                {n.teacher}
              </span>
            </div>
            <p className={`font-bold text-[15px] leading-relaxed break-keep ${isOpen ? "" : "truncate"}`}>{n.question}</p>
          </div>
          <Chevron className={isOpen ? "rotate-180" : ""} />
        </button>

        {isOpen && (
          <div className="px-5 pb-5 flex flex-col gap-1.5">
            {n.choices.map((c, ci) => {
              const isAnswer = ci === n.answer;
              const isMine = ci === n.chosen && !isAnswer;
              return (
                <div
                  key={ci}
                  className="flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[14px] leading-relaxed"
                  style={
                    isAnswer
                      ? { background: "var(--blue-weak)", color: "var(--blue)", fontWeight: 700 }
                      : isMine
                        ? { background: "var(--red-weak)", color: "var(--red)", fontWeight: 700 }
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
            {n.explanation && (
              <p className="text-[14px] leading-relaxed mt-1.5 break-keep" style={{ color: "var(--sub-2)" }}>
                {n.explanation}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-4xl mx-auto px-4 sm:px-5 pt-2 pb-8 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <div className="rise flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 min-h-11">
          <BackButton fallback="/quiz" />
          <Link href="/quiz" className="chip shrink-0 h-9 !py-0 flex items-center !text-[13px]">
            문제 풀기
          </Link>
        </div>
        <h1 className="text-[24px] lg:text-[28px] font-bold tracking-tight">오답노트</h1>
        <p className="text-sub text-[15px] leading-normal">틀린 문제는 전부 기록돼요. 다시 맞히면 극복한 오답으로 내려가요.</p>
      </div>

      {data === null && <div className="skel h-32 !rounded-[16px]" />}

      {data && (
        // PC에선 좌(요약·다시 풀기 sticky) / 우(오답 목록) 2단 — 모바일 기둥 방지
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:items-start">
        <div className="flex flex-col gap-3 lg:sticky lg:top-[76px]">
          <div className="rise d1 card p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-x-3 gap-y-4">
            {(
              [
                ["푼 문제", data.totals.attempted, false],
                ["맞은 문제", data.totals.correct, false],
                ["남은 오답", data.totals.wrong, true],
                ["극복한 오답", data.totals.overcome, false],
              ] as const
            ).map(([label, n, warn]) => (
              <div key={label}>
                <p className="text-[13px] text-sub">{label}</p>
                <p
                  className="mt-1 text-[24px] font-bold tabular-nums"
                  style={warn && n > 0 ? { color: "var(--red)" } : label === "극복한 오답" && n > 0 ? { color: "var(--blue)" } : undefined}
                >
                  {n}
                </p>
              </div>
            ))}
          </div>

          {remain.length > 0 && (
            <div className="rise d2 flex flex-col gap-2">
              <Link href="/quiz?mode=wrong" className="btn btn-primary h-[50px] text-[17px] flex items-center justify-center text-center">
                오답 전체 다시 풀기 · {remain.length}문제
              </Link>
              {groups.length > 1 &&
                groups.map(([tid, g]) => (
                  <Link
                    key={tid}
                    href={`/quiz?mode=wrong&teacher=${tid}`}
                    className="btn h-12 px-4 text-[15px] flex items-center justify-center text-center bg-surface border border-line text-text hover:bg-[var(--fill)]"
                  >
                    <span className="truncate">
                      {g.name} 오답만 다시 풀기 · {g.n}문제
                    </span>
                  </Link>
                ))}
            </div>
          )}
          </div>

          <div className="flex flex-col gap-3">
          {data.notes.length === 0 && (
            <div className="rise d2 card p-10 text-center">
              <p className="text-[16px] font-bold mb-1">틀린 문제가 없어요</p>
              <p className="text-sub text-[14px]">
                {data.totals.attempted === 0 ? "문제를 풀면 틀린 것만 여기에 모여요." : "지금까지 푼 문제를 모두 맞혔어요."}
              </p>
            </div>
          )}

          {data.notes.length > 0 && remain.length === 0 && (
            <div className="rise d2 card p-6 text-center">
              <p className="text-[16px] font-bold mb-1">남은 오답이 없어요</p>
              <p className="text-sub text-[14px]">틀렸던 문제를 전부 극복했어요. 기록은 아래에 그대로 남아 있어요.</p>
            </div>
          )}

          {remain.length > 0 && <h2 className="rise d2 mt-2 lg:mt-0 px-1 text-[17px] font-bold">남은 오답 {remain.length}</h2>}
          <div className="flex flex-col gap-2">{remain.map(noteCard)}</div>

          {/* 극복한 오답 — 접어 두고 눌러서 펼친다. 남은 오답이 없으면 처음부터 펼침 */}
          {overcome.length > 0 && (
            <details className="group" open={remain.length === 0}>
              <summary
                className="list-none [&::-webkit-details-marker]:hidden cursor-pointer h-[52px] rounded-[12px] flex items-center justify-center gap-1.5 text-[15px] font-bold transition-colors hover:bg-[var(--fill)]"
                style={{ color: "var(--sub-2)" }}
              >
                극복한 오답 {overcome.length}개 보기
                <Chevron className="group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-2 mt-1">
                <p className="px-1 text-sub text-[13px]">틀렸다가 다시 풀어서 맞힌 문제예요. 시험 전에 한 번 더 봐두면 좋아요.</p>
                {overcome.map(noteCard)}
              </div>
            </details>
          )}
          </div>
        </div>
      )}
    </main>
  );
}

const TAG = "inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold whitespace-nowrap";

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-sub transition-transform ${className}`}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
