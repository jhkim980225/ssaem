"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import { StemView, ExplanationView, ChoiceView, Hi } from "@/components/BankQuestion";
import { ExcelTry } from "@/components/ExcelPad";
import JournalEntry from "@/components/JournalEntry";

type Item = {
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
  images: string[] | null;
  chosen: number | null;
  correct: boolean;
};
type Session = { id: string; subject: string; source: string | null; total: number; score: number; at: string };

// 시험 기록 상세 — 이 회차에서 무엇을 틀렸는지 문항별로 되짚는다.
// 기본은 틀린 문항만 (기록을 여는 이유가 그것) — 맞은 문항은 토글로 함께 본다.
export default function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session, gate, allowed } = useGate("any", { loginMessage: "시험 기록은 계정에 저장돼요." });
  const [data, setData] = useState<{ session: Session; items: Item[] } | null>(null);
  const [err, setErr] = useState("");
  const [onlyWrong, setOnlyWrong] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed || !session) return;
    fetch(`/api/bank/records/${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok && d?.session) {
          const items: Item[] = d.items ?? [];
          setData({ session: d.session, items });
          // 틀린 문항이 전부 펼쳐져 있으면 스크롤이 길다 — 첫 오답만 열어 둔다
          setOpen(items.find((x) => !x.correct)?.id ?? null);
        } else setErr(d?.error === "not found" ? "기록을 찾을 수 없어요." : d?.error ?? "불러오지 못했어요.");
      })
      .catch(() => setErr("불러오지 못했어요."));
  }, [allowed, session, id]);

  const wrong = useMemo(() => (data?.items ?? []).filter((i) => !i.correct), [data]);
  const shown = onlyWrong ? wrong : data?.items ?? [];

  if (gate) return gate;

  const s = data?.session;
  const pct = s && s.total ? Math.round((s.score / s.total) * 100) : 0;
  const title = s ? (s.subject === "오답노트" ? "오답노트 다시 풀기" : s.source ?? `${s.subject} 랜덤`) : "";

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-5xl mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center justify-between gap-3">
        <BackButton fallback="/my/records" />
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </header>
      <section className="rise px-1 pb-1 min-w-0">
        <h1 className="text-[24px] lg:text-[28px] font-bold truncate mb-1.5">{title || "시험 기록"}</h1>
        {s && (
          <p className="text-sub text-[15px]">
            {new Date(s.at).toLocaleString("ko-KR", {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        )}
      </section>

      {err && (
        <section className="rise d1 card p-5 flex flex-col gap-3 lg:max-w-2xl">
          <p className="text-sub text-[14px]">{err}</p>
          <Link href="/my/records" className="btn btn-gray py-2 px-5 self-start text-[13px]">
            기록 목록으로
          </Link>
        </section>
      )}

      {!data && !err && <div className="rise d1 skel h-64 !rounded-[16px]" />}

      {data && s && (
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-5 lg:items-start flex flex-col gap-3">
          <div className="flex flex-col gap-3 min-w-0">
            {data.items.length === 0 ? (
              <section className="rise d1 card p-8 text-center">
                <p className="text-[15px] font-bold mb-1">문항 기록이 남아 있지 않아요</p>
                <p className="text-sub text-[13px]">
                  이 기능이 생기기 전에 응시한 회차예요. 점수만 남아 있고 문항별 정답·오답은 없어요.
                </p>
              </section>
            ) : (
              <>
                {/* 틀린/전체 세그먼트 */}
                <div
                  role="tablist"
                  aria-label="문항 보기"
                  className="rise d1 grid grid-cols-2 gap-1 p-1 rounded-[10px]"
                  style={{ background: "var(--fill)" }}
                >
                  <button
                    role="tab"
                    aria-selected={onlyWrong}
                    onClick={() => setOnlyWrong(true)}
                    className={`h-10 rounded-[7px] text-[15px] transition-colors ${onlyWrong ? "bg-surface font-bold text-text" : "font-semibold text-sub"}`}
                  >
                    틀린 문항 {wrong.length}개
                  </button>
                  <button
                    role="tab"
                    aria-selected={!onlyWrong}
                    onClick={() => setOnlyWrong(false)}
                    className={`h-10 rounded-[7px] text-[15px] transition-colors ${!onlyWrong ? "bg-surface font-bold text-text" : "font-semibold text-sub"}`}
                  >
                    전체 {data.items.length}문항
                  </button>
                </div>

                {shown.length === 0 && (
                  <section className="rise d2 card p-8 text-center">
                    <p className="text-[15px] font-bold mb-1">다 맞혔어요</p>
                    <p className="text-sub text-[13px]">이 회차엔 틀린 문항이 없어요.</p>
                  </section>
                )}

                <div className="flex flex-col gap-3">
                  {shown.map((n, i) => {
                    const isOpen = open === n.id;
                    const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
                    return (
                      <article key={n.id} className="rise card overflow-hidden">
                        <button
                          onClick={() => setOpen(isOpen ? null : n.id)}
                          aria-expanded={isOpen}
                          className="w-full text-left px-5 py-[18px] flex flex-col gap-2"
                        >
                          <div className="flex gap-1.5 items-center min-w-0">
                            <span className="text-[15px] font-bold tabular-nums shrink-0">{i + 1}번</span>
                            <span
                              className="shrink-0 h-6 px-2 rounded-[6px] text-[12px] font-bold inline-flex items-center"
                              style={
                                n.correct
                                  ? { color: "var(--blue)", background: "var(--blue-weak)" }
                                  : { color: "var(--red)", background: "var(--red-weak)" }
                              }
                            >
                              {n.correct ? "정답" : "오답"}
                            </span>
                            <span
                              className="min-w-0 truncate h-6 px-2 rounded-[6px] text-[12px] font-semibold leading-6 text-[var(--sub-2)]"
                              style={{ background: "var(--fill)" }}
                            >
                              {n.typeTag}
                            </span>
                            <svg
                              width="20"
                              height="20"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`ml-auto shrink-0 text-sub transition-transform ${isOpen ? "rotate-180" : ""}`}
                              aria-hidden
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </div>
                          {/* 펼치면 아래 StemView가 지문 전체를 보여준다 — 접혔을 때만 한 줄 미리보기 */}
                          {!isOpen && (
                            <p className="text-[15px] line-clamp-1 break-keep">
                              <Hi text={n.stem.split("\n")[0]} />
                            </p>
                          )}
                        </button>

                        {isOpen && (
                          <div className="px-5 pb-5 flex flex-col gap-3.5">
                            <StemView stem={n.stem} images={n.images} />
                            {isTheory ? (
                              <div className="flex flex-col gap-1.5">
                                {n.choices!.map((c, ci) => {
                                  const isAnswer = n.answerIdx === ci;
                                  const isMine = n.chosen === ci;
                                  const style: React.CSSProperties = isAnswer
                                    ? { color: "var(--blue)", background: "var(--blue-weak)" }
                                    : isMine
                                      ? { color: "var(--red)", background: "var(--red-weak)" }
                                      : { background: "var(--fill-2)" };
                                  return (
                                    <div
                                      key={ci}
                                      style={style}
                                      className={`rounded-[8px] px-3.5 py-3 text-[14px] leading-[1.6] break-keep flex items-start gap-2.5 ${
                                        isAnswer || isMine ? "font-bold" : ""
                                      }`}
                                    >
                                      <span className="shrink-0 grid place-items-center w-5 h-5 mt-px rounded-full border border-current text-[11px] font-bold">
                                        {ci + 1}
                                      </span>
                                      <span className="flex-1 min-w-0">
                                        <ChoiceView text={c} />
                                      </span>
                                      {isAnswer && <span className="text-[12px] font-bold shrink-0">정답</span>}
                                      {isMine && !isAnswer && <span className="text-[12px] font-bold shrink-0">내 답</span>}
                                    </div>
                                  );
                                })}
                                {/* 안 고르고 넘어간 문항 — 빈 화면이 되지 않게 명시 */}
                                {n.chosen === null && (
                                  <p className="text-sub text-[13px]">답을 고르지 않고 넘어간 문항이에요.</p>
                                )}
                              </div>
                            ) : (
                              n.answerText && (
                                <div className="rounded-[10px] p-3.5" style={{ background: "var(--blue-weak)" }}>
                                  <p className="text-[12px] font-bold text-blue mb-1.5">정답 (분개)</p>
                                  <JournalEntry text={n.answerText} />
                                </div>
                              )
                            )}
                            <ExcelTry area={n.area} stem={n.stem} choices={n.choices} />
                            {n.explanation && (
                              <div className="rounded-[10px] p-3.5" style={{ background: "var(--fill-2)" }}>
                                <p className="text-[14px] font-bold mb-1">해설</p>
                                <ExplanationView text={n.explanation} />
                              </div>
                            )}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </>
            )}

            {/* 모바일은 목록 맨 아래 큰 버튼 — PC는 우측 요약 카드 안에 있다 */}
            <Link
              href="/bank/notes"
              className="btn btn-primary h-[50px] text-[17px] flex items-center justify-center lg:hidden"
            >
              오답노트 보기
            </Link>
          </div>

          {/* 점수 요약 — 모바일은 맨 위, PC는 우측 레일 */}
          <aside className="rise d1 card px-5 py-6 flex flex-col gap-4 text-center order-first lg:order-none lg:sticky lg:top-[76px]">
            <div>
              <p className="text-sub text-[14px] truncate">{s.subject}</p>
              <p
                className="text-[40px] font-bold tabular-nums leading-tight mt-2"
                style={{ color: pct >= 60 ? "var(--blue)" : "var(--red)" }}
              >
                {pct}점
              </p>
              <p className="text-[15px] text-[var(--sub-2)]">
                {s.total}문항 중 {s.score}문항 맞혔어요
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["점수", `${s.score} / ${s.total}`],
                  ["정답률", `${pct}%`],
                  ["틀린 문항", `${wrong.length}`],
                ] as const
              ).map(([label, v]) => {
                const red = label === "틀린 문항" && wrong.length > 0;
                return (
                  <div
                    key={label}
                    className="rounded-[10px] px-1 py-3"
                    style={red ? { background: "var(--red-weak)", color: "var(--red)" } : { background: "var(--fill-2)" }}
                  >
                    <p className={`text-[12px] ${red ? "" : "text-sub"}`}>{label}</p>
                    <p className="text-[17px] font-bold tabular-nums mt-1">{v}</p>
                  </div>
                );
              })}
            </div>
            <Link href="/bank/notes" className="btn btn-gray w-full py-2.5 text-[13px] text-center hidden lg:block">
              오답노트 보기
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
