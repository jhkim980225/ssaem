"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import JournalEntry from "@/components/JournalEntry";

type Note = {
  id: string;
  subject: string;
  category: string;
  typeTag: string;
  stem: string;
  choices: string[] | null;
  answerIdx: number | null;
  answerText: string | null;
  explanation: string | null;
  chosen: number | null;
  at: string;
};
type Data = { totals: { attempted: number; wrong: number; correct: number }; notes: Note[] };

// 문제은행 전용 오답노트 — 마지막 시도가 오답인 기출문항. 강사 그룹핑 없음(전역).
export default function BankNotesPage() {
  const { session, gate } = useGate("any", { loginMessage: "오답노트는 계정에 저장돼요." });
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    fetch("/api/bank/attempt", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setData(d.totals ? d : { totals: { attempted: 0, wrong: 0, correct: 0 }, notes: [] }))
      .catch(() => setData({ totals: { attempted: 0, wrong: 0, correct: 0 }, notes: [] }));
  }, [session]);

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">기출 오답노트</h1>
          <p className="text-sub text-[14px]">틀렸던 기출문제만 모았어요. 다시 맞히면 빠져요.</p>
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      {data === null && <div className="skel h-40 !rounded-[20px]" />}

      {data && (
        <div className="rise d1 grid grid-cols-3 gap-2">
          {(
            [
              ["푼 문제", data.totals.attempted],
              ["맞은 문제", data.totals.correct],
              ["틀린 문제", data.totals.wrong],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-sub text-[12px]">{label}</p>
              <p className="text-[22px] font-extrabold tabular-nums">{n}</p>
            </div>
          ))}
        </div>
      )}

      {data && data.notes.length === 0 && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">틀린 문제가 없어요</p>
          <p className="text-sub text-[13px] mb-5">기출문제를 풀다 틀리면 여기에 모여요.</p>
          <Link href="/bank" className="btn btn-primary py-3 px-6 inline-block">
            기출문제 풀기
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(data?.notes ?? []).map((n) => {
          const isOpen = open === n.id;
          const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
          return (
            <div key={n.id} className="rise card overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : n.id)}
                className="w-full text-left p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex gap-1.5 flex-wrap mb-1">
                    <span className="chip !py-0.5 !px-2 !text-[11px]">{n.subject}</span>
                    <span className="chip !py-0.5 !px-2 !text-[11px]">{n.typeTag}</span>
                  </div>
                  <p className="text-[14px] font-medium line-clamp-2">{n.stem.split("\n")[0]}</p>
                </div>
                <span className="text-sub text-[13px] shrink-0">{isOpen ? "접기" : "보기"}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 flex flex-col gap-3 border-t border-line pt-3">
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{n.stem}</p>
                  {isTheory ? (
                    <div className="flex flex-col gap-1.5">
                      {n.choices!.map((c, i) => {
                        const isAnswer = n.answerIdx === i;
                        const isMine = n.chosen === i;
                        const style: React.CSSProperties = isAnswer
                          ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                          : isMine
                            ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                            : {};
                        return (
                          <div key={i} style={style} className="rounded-[12px] border border-line px-3 py-2 text-[13px] flex items-start gap-2">
                            <span className="shrink-0 grid place-items-center mt-0.5 rounded-full border border-current text-[10px] font-extrabold" style={{ width: 18, height: 18 }}>
                              {i + 1}
                            </span>
                            <span>
                              {c}
                              {isAnswer && <span className="text-blue text-[11px] ml-1.5 font-bold">정답</span>}
                              {isMine && !isAnswer && <span className="text-[11px] ml-1.5 font-bold" style={{ color: "var(--red)" }}>내 답</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    n.answerText && (
                      <div className="rounded-[12px] border border-line p-3" style={{ background: "var(--blue-weak)" }}>
                        <p className="text-[12px] font-bold text-blue mb-1.5">정답 (분개)</p>
                        <JournalEntry text={n.answerText} />
                      </div>
                    )
                  )}
                  {n.explanation && (
                    <div className="rounded-[12px] border border-line p-3">
                      <p className="text-[12px] font-bold text-sub mb-1">해설</p>
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{n.explanation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
