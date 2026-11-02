"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import BankStats, { type BankStatsData } from "@/components/BankStats";

type Rec = {
  id: string;
  subject: string;
  source: string | null;
  total: number;
  score: number;
  at: string;
  /** 문항별 정오답이 남아 있는 기록만 상세로 들어갈 수 있다 (옛 기록은 점수만 있다) */
  hasDetail?: boolean;
};

// 내 기출 시험 기록 (CBT 세션 단위 점수)
export default function MyRecordsPage() {
  const { session, gate } = useGate("any", { loginMessage: "시험 기록은 계정에 저장돼요." });
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [stats, setStats] = useState<BankStatsData | null>(null);

  useEffect(() => {
    if (!session) return;
    const h = { headers: { Authorization: `Bearer ${session.access_token}` } };
    fetch("/api/bank/records", h)
      .then((r) => r.json())
      .then((d) => setRecs(d.records ?? []))
      .catch(() => setRecs([]));
    fetch("/api/bank/stats", h)
      .then((r) => r.json())
      .then((d) => setStats(d.stats ?? null))
      .catch(() => {});
  }, [session]);

  if (gate) return gate;

  const best = (recs ?? []).reduce((m, r) => Math.max(m, r.total ? Math.round((r.score / r.total) * 100) : 0), 0);
  // 통계가 없으면(아직 한 문제도 안 푼 학생) 2컬럼으로 가르지 않는다 — 우측이 빈 채로 남아
  // 화면이 잘린 것처럼 보인다
  const hasStats = Boolean(stats && stats.totals.attempts > 0);

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-5xl mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center justify-between gap-3">
        <BackButton fallback="/bank" />
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </header>
      <section className="rise px-1 pb-1">
        <h1 className="text-[24px] lg:text-[28px] font-bold mb-1.5">내 시험 기록</h1>
        <p className="text-sub text-[15px] leading-normal">CBT 모의고사 응시 기록이에요. 채점할 때마다 쌓여요.</p>
      </section>

      {recs === null && <div className="skel h-40 !rounded-[16px]" />}

      {/* PC는 회차 목록(좌) + 통계(우) 2컬럼 — 통계 막대가 길어 세로로 쌓으면 정작 기록이 화면 밖으로 밀린다.
          모바일은 시안대로 통계 카드(정답률·응시 횟수) 먼저, 응시 기록 리스트 다음 */}
      <div
        className={`flex flex-col gap-3 ${
          hasStats ? "lg:grid lg:grid-cols-[1fr_360px] lg:gap-5 lg:items-start" : ""
        }`}
      >
      {/* 통계는 PC에서 우측 레일 */}
      {recs && (recs.length > 0 || hasStats) && (
        <section className="rise d1 card px-5 py-[22px] flex flex-col gap-5 lg:order-2">
          {hasStats && stats && <BankStats stats={stats} />}
          {recs.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["응시 횟수", `${recs.length}회`],
                ["최고 정답률", `${best}%`],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="rounded-[12px] p-3.5" style={{ background: "var(--fill-2)" }}>
                <p className="text-[13px] text-sub">{label}</p>
                <p className="text-[20px] font-bold tabular-nums mt-1">{v}</p>
              </div>
            ))}
          </div>
          )}
        </section>
      )}

      <div className="flex flex-col gap-3 min-w-0 lg:order-1">
      {recs && recs.length === 0 && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 시험 기록이 없어요</p>
          <p className="text-sub text-[13px] mb-5">CBT 모의고사를 풀고 채점하면 여기에 쌓여요.</p>
          <Link href="/bank" className="btn btn-primary py-3 px-6 inline-block">
            CBT 풀러 가기
          </Link>
        </div>
      )}

      {recs && recs.length > 0 && (
        <>
          <h2 className="mt-3 lg:mt-0 px-1 text-[17px] font-bold">응시 기록</h2>
          <section className="rise d2 card px-5 py-1">
            {recs.map((r, i) => {
              const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
              const wrong = r.total - r.score;
              const row = `flex items-center gap-3 py-4 ${i > 0 ? "border-t border-line" : ""}`;
              const body = (
                <>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-bold truncate">{r.subject === "오답노트" ? "오답노트 다시 풀기" : r.source ? r.source : `${r.subject} 랜덤`}</p>
                    <p className="text-sub text-[13px] mt-0.5">
                      {new Date(r.at).toLocaleString("ko-KR", {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {/* 왜 어떤 카드는 안 눌리는지 알 수 있게 — 옛 기록엔 문항 기록이 없다 */}
                      {r.hasDetail
                        ? wrong > 0 && (
                            <span style={{ color: "var(--red)" }}>
                              {" "}
                              · 틀린 문항 {wrong}개 보기
                            </span>
                          )
                        : " · 문항 기록 없음"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[16px] font-bold tabular-nums" style={{ color: pct >= 60 ? "var(--blue)" : "var(--red)" }}>
                      {pct}%
                    </p>
                    <p className="text-[13px] text-sub tabular-nums mt-0.5">
                      {r.score} / {r.total}
                    </p>
                  </div>
                </>
              );
              return r.hasDetail ? (
                <Link key={r.id ?? i} href={`/my/records/${r.id}`} className={`${row} hover:opacity-80 transition-opacity`}>
                  {body}
                </Link>
              ) : (
                <div key={r.id ?? i} className={row}>
                  {body}
                </div>
              );
            })}
          </section>
        </>
      )}
      </div>
      </div>
    </main>
  );
}
