"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import { StemView, ExplanationView, ChoiceView } from "@/components/BankQuestion";
import JournalEntry from "@/components/JournalEntry";

type Item = {
  id: string;
  subject: string;
  category: string;
  typeTag: string;
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
    <main className="flex-1 w-full max-w-2xl lg:max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <BackButton fallback="/my/records" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold truncate">{title || "시험 기록"}</h1>
          {s && (
            <p className="text-sub text-[14px]">
              {new Date(s.at).toLocaleString("ko-KR", {
                year: "numeric",
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      {err && (
        <section className="rise d1 card p-5 flex flex-col gap-3 lg:max-w-2xl">
          <p className="text-sub text-[14px]">{err}</p>
          <Link href="/my/records" className="btn btn-gray py-2 px-5 self-start text-[13px]">
            기록 목록으로
          </Link>
        </section>
      )}

      {!data && !err && <div className="rise d1 skel h-64 !rounded-[20px]" />}

      {data && s && (
        <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-5 lg:items-start flex flex-col gap-4">
          <div className="flex flex-col gap-3 min-w-0">
            {/* 모바일 요약 — PC는 우측 레일이 대신한다 */}
            <div className="rise d1 grid grid-cols-3 gap-2 lg:hidden">
              {(
                [
                  ["점수", `${s.score}/${s.total}`],
                  ["정답률", `${pct}%`],
                  ["틀린 문항", `${wrong.length}개`],
                ] as const
              ).map(([label, v]) => (
                <div key={label} className="card p-3 text-center">
                  <p className="text-[18px] font-extrabold tabular-nums">{v}</p>
                  <p className="text-[11px] text-sub mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {data.items.length === 0 ? (
              <section className="rise d1 card p-8 text-center">
                <p className="text-[15px] font-bold mb-1">문항 기록이 남아 있지 않아요</p>
                <p className="text-sub text-[13px]">
                  이 기능이 생기기 전에 응시한 회차예요. 점수만 남아 있고 문항별 정답·오답은 없어요.
                </p>
              </section>
            ) : (
              <>
                <div className="rise d1 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => setOnlyWrong(true)}
                    className={`chip !text-[13px] ${onlyWrong ? "chip-on" : ""}`}
                  >
                    틀린 문항 {wrong.length}개
                  </button>
                  <button
                    onClick={() => setOnlyWrong(false)}
                    className={`chip !text-[13px] ${!onlyWrong ? "chip-on" : ""}`}
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

                <div className="flex flex-col gap-2">
                  {shown.map((n, i) => {
                    const isOpen = open === n.id;
                    const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
                    return (
                      <div key={n.id} className="rise card overflow-hidden">
                        <button
                          onClick={() => setOpen(isOpen ? null : n.id)}
                          className="w-full text-left p-4 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="flex gap-1.5 flex-wrap mb-1 items-center">
                              <span className="text-sub text-[12px] font-bold tabular-nums">{i + 1}번</span>
                              <span
                                className="chip !py-0.5 !px-2 !text-[11px]"
                                style={
                                  n.correct
                                    ? { color: "var(--blue)", background: "var(--blue-weak)" }
                                    : { color: "var(--red)", background: "var(--red-weak)" }
                                }
                              >
                                {n.correct ? "정답" : "오답"}
                              </span>
                              <span className="chip !py-0.5 !px-2 !text-[11px]">{n.typeTag}</span>
                            </div>
                            <p className="text-[14px] font-medium line-clamp-2 break-keep">{n.stem.split("\n")[0]}</p>
                          </div>
                          <span className="text-sub text-[13px] shrink-0">{isOpen ? "접기" : "보기"}</span>
                        </button>

                        {isOpen && (
                          <div className="px-4 lg:px-5 pb-5 flex flex-col gap-4 border-t border-line pt-4">
                            <StemView stem={n.stem} images={n.images} />
                            {isTheory ? (
                              <div className="flex flex-col gap-2.5">
                                {n.choices!.map((c, ci) => {
                                  const isAnswer = n.answerIdx === ci;
                                  const isMine = n.chosen === ci;
                                  const style: React.CSSProperties = isAnswer
                                    ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                                    : isMine
                                      ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                                      : {};
                                  return (
                                    <div
                                      key={ci}
                                      style={style}
                                      className="rounded-[14px] border border-line px-4 py-3.5 min-h-[54px] text-[15px] leading-[1.65] break-keep flex items-start gap-3"
                                    >
                                      <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                                        {ci + 1}
                                      </span>
                                      <span className="flex-1 min-w-0"><ChoiceView text={c} /></span>
                                      {isAnswer && <span className="text-blue text-[11px] font-bold shrink-0">정답</span>}
                                      {isMine && !isAnswer && (
                                        <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--red)" }}>
                                          내 답
                                        </span>
                                      )}
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
                                <div className="rounded-[14px] border border-line p-4" style={{ background: "var(--blue-weak)" }}>
                                  <p className="text-[12px] font-bold text-blue mb-1.5">정답 (분개)</p>
                                  <JournalEntry text={n.answerText} />
                                </div>
                              )
                            )}
                            {n.explanation && (
                              <div className="rounded-[14px] border border-line p-4">
                                <p className="text-[12px] font-bold text-sub mb-1.5">해설</p>
                                <ExplanationView text={n.explanation} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <aside className="rise d2 card p-5 hidden lg:flex flex-col gap-3">
            <h3 className="font-bold text-[15px]">채점 결과</h3>
            <div className="text-center py-2">
              <p className="text-[32px] font-extrabold tabular-nums leading-none">
                {s.score}
                <span className="text-[16px] text-sub"> / {s.total}</span>
              </p>
              <p
                className="text-[14px] font-bold tabular-nums mt-1"
                style={{ color: pct >= 60 ? "var(--blue)" : "var(--red)" }}
              >
                {pct}%
              </p>
            </div>
            <dl className="flex flex-col gap-2 text-[14px]">
              <div className="flex justify-between gap-2">
                <dt className="text-sub">과목</dt>
                <dd className="font-bold text-right min-w-0 truncate">{s.subject}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-sub">틀린 문항</dt>
                <dd className="font-bold text-right" style={{ color: wrong.length ? "var(--red)" : undefined }}>
                  {wrong.length}개
                </dd>
              </div>
            </dl>
            <Link href="/bank/notes" className="btn btn-gray w-full py-2.5 text-[13px] text-center">
              오답노트 보기
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
