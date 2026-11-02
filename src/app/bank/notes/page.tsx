"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import JournalEntry from "@/components/JournalEntry";
import {
  StemView,
  ExplanationView,
  ChoiceView,
  Hi,
  TAG,
  TAG_FILL,
  TAG_ON,
  CHOICE_BOX,
  CHOICE_NUM,
  choiceTone,
} from "@/components/BankQuestion";
import { ExcelTry } from "@/components/ExcelPad";

type Note = {
  id: string;
  subject: string;
  category: string;
  typeTag: string;
  area?: string;
  stem: string;
  choices: string[] | null;
  answerIdx: number | null;
  answerText: string | null;
  explanation: string | null;
  images?: string[] | null;
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
    <main className="flex-1 w-full max-w-3xl lg:max-w-4xl mx-auto px-4 lg:px-6 py-6 lg:py-8 flex flex-col gap-3">
      <div className="rise px-1 pt-1 flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-bold">기출 오답노트</h1>
          <p className="text-sub text-[15px] leading-normal">틀렸던 기출문제만 모았어요. 다시 맞히면 빠져요.</p>
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      {data === null && <div className="skel h-40 !rounded-[16px]" />}

      {data && (
        <section className="rise d1 card p-5 grid grid-cols-3 gap-3">
          {(
            [
              ["푼 문제", data.totals.attempted, false],
              ["맞은 문제", data.totals.correct, false],
              ["틀린 문제", data.totals.wrong, true],
            ] as const
          ).map(([label, n, bad]) => (
            <div key={label}>
              <p className="text-[13px] text-sub">{label}</p>
              <p className="text-[22px] font-bold tabular-nums mt-1" style={bad && n > 0 ? { color: "var(--red)" } : undefined}>
                {n}
              </p>
            </div>
          ))}
        </section>
      )}

      {/* 틀린 문제가 있으면 바로 재도전 — 완주하면 시험 기록(subject 오답노트)으로 남는다 */}
      {data && data.notes.length > 0 && (
        <Link href="/bank?retry=wrong" className="rise d1 btn btn-primary h-[50px] text-[17px] grid place-items-center text-center">
          오답 다시 풀기 ({data.totals.wrong}문제 중 최대 15문제)
        </Link>
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

      <div className="flex flex-col gap-3">
        {(data?.notes ?? []).map((n) => {
          const isOpen = open === n.id;
          const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
          return (
            <article key={n.id} className="rise card overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : n.id)}
                aria-expanded={isOpen}
                className="w-full text-left px-5 py-[18px] flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex gap-1.5 flex-wrap mb-2">
                    <span className={TAG} style={TAG_ON}>
                      {n.subject}
                    </span>
                    <span className={TAG} style={TAG_FILL}>
                      {n.typeTag}
                    </span>
                  </div>
                  <p className={`text-[15px] font-bold break-keep ${isOpen ? "" : "line-clamp-1"}`}>
                    <Hi text={n.stem.split("\n")[0]} />
                  </p>
                </div>
                <span className="text-blue text-[14px] font-semibold shrink-0">{isOpen ? "접기" : "보기"}</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 flex flex-col gap-4 border-t border-line pt-4">
                  <StemView stem={n.stem} images={n.images} />
                  {isTheory ? (
                    <div className="flex flex-col gap-2">
                      {n.choices!.map((c, i) => {
                        const isAnswer = n.answerIdx === i;
                        const isMine = n.chosen === i;
                        const tone = choiceTone(isAnswer ? "on" : isMine ? "bad" : null);
                        return (
                          <div key={i} style={tone.box} className={CHOICE_BOX}>
                            <span className={CHOICE_NUM} style={tone.num}>
                              {i + 1}
                            </span>
                            <span className="flex-1 min-w-0"><ChoiceView text={c} /></span>
                            {isAnswer && <span className="text-blue text-[12px] font-bold shrink-0 mt-0.5">정답</span>}
                            {isMine && !isAnswer && (
                              <span className="text-[12px] font-bold shrink-0 mt-0.5" style={{ color: "var(--red)" }}>
                                내 답
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    n.answerText && (
                      <div>
                        <p className="text-[13px] font-bold mb-2" style={{ color: "var(--sub-2)" }}>정답 (분개)</p>
                        <div className="rounded-[10px] p-3.5" style={{ background: "var(--fill-2)" }}>
                          <JournalEntry text={n.answerText} />
                        </div>
                      </div>
                    )
                  )}
                  <ExcelTry area={n.area} stem={n.stem} choices={n.choices} />
                  {n.explanation && (
                    <div className="rounded-[12px] p-4" style={{ background: "var(--fill-2)" }}>
                      <p className="text-[13px] font-bold mb-1.5">해설</p>
                      <ExplanationView text={n.explanation} />
                    </div>
                  )}
                  <button
                    onClick={() => setOpen(null)}
                    className="btn btn-gray h-11 !rounded-[8px] text-[14px]"
                  >
                    접기
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
