"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import BankStats, { type BankStatsData } from "@/components/BankStats";

type Rec = { subject: string; source: string | null; total: number; score: number; at: string };

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

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">내 시험 기록</h1>
          <p className="text-sub text-[14px]">CBT 모의고사 응시 기록이에요. 채점할 때마다 쌓여요.</p>
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      {recs === null && <div className="skel h-40 !rounded-[20px]" />}

      {recs && recs.length > 0 && (
        <div className="rise d1 grid grid-cols-2 gap-2">
          {(
            [
              ["응시 횟수", `${recs.length}회`],
              ["최고 정답률", `${best}%`],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-[24px] font-extrabold tabular-nums">{v}</p>
              <p className="text-[12px] text-sub mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {stats && stats.totals.attempts > 0 && (
        <section className="rise d2 card p-5 flex flex-col gap-3">
          <h2 className="font-bold text-[16px]">풀이 통계</h2>
          <BankStats stats={stats} />
        </section>
      )}

      {recs && recs.length === 0 && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 시험 기록이 없어요</p>
          <p className="text-sub text-[13px] mb-5">CBT 모의고사를 풀고 채점하면 여기에 쌓여요.</p>
          <Link href="/bank" className="btn btn-primary py-3 px-6 inline-block">
            CBT 풀러 가기
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(recs ?? []).map((r, i) => {
          const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
          return (
            <div key={i} className="rise card flex items-center gap-3 p-4">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold truncate">{r.subject === "오답노트" ? "오답노트 다시 풀기" : r.source ? r.source : `${r.subject} 랜덤`}</p>
                <p className="text-sub text-[12px]">
                  {new Date(r.at).toLocaleString("ko-KR", {
                    year: "numeric",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[18px] font-extrabold tabular-nums">
                  {r.score}
                  <span className="text-[13px] text-sub"> / {r.total}</span>
                </p>
                <p className="text-[12px] font-bold tabular-nums" style={{ color: pct >= 60 ? "var(--blue)" : "var(--red)" }}>
                  {pct}%
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
