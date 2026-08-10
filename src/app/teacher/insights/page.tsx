"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";

type Insights = {
  days: number;
  totals: { questions: number; answers: number; up: number; down: number };
  daily: { date: string; count: number }[];
  lowRated: { question: string; answer: string; rating: number; created_at: string }[];
  weak: { question: string; created_at: string; reason: string }[];
};

export default function InsightsPage() {
  const { session, gate } = useGate("teacher");
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!session) return;
    fetch("/api/insights", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch(() => setErr("불러오기 실패"));
  }, [session]);

  if (gate) return gate;

  const max = Math.max(1, ...(data?.daily.map((d) => d.count) ?? [1]));

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">인사이트</h1>
        <p className="text-sub text-[14px]">최근 {data?.days ?? 14}일 학생 질문과 답변 품질이에요.</p>
      </div>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {!data && !err && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-24 !rounded-[20px]" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* 스탯 타일 */}
          <div className="rise d1 grid grid-cols-2 lg:grid-cols-4 gap-2">
            {(
              [
                ["질문", data.totals.questions],
                ["답변", data.totals.answers],
                ["도움됨", data.totals.up],
                ["아쉬움", data.totals.down],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="card p-4">
                <p className="text-sub text-[12px]">{label}</p>
                <p className="text-[24px] font-extrabold tabular-nums">{n}</p>
              </div>
            ))}
          </div>

          {/* 일별 질문 추이 — 단일 시리즈 막대 (범례 불필요) */}
          <section className="rise d2 card p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bold text-[15px]">일별 질문 수</h2>
              <span className="text-sub text-[12px]">최대 {max}건</span>
            </div>
            {data.totals.questions === 0 ? (
              <p className="text-sub text-[14px] py-6 text-center">아직 질문이 없어요.</p>
            ) : (
              <div className="flex items-end gap-[2px] h-28" role="img" aria-label="일별 질문 수 막대 그래프">
                {data.daily.map((d) => (
                  <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                    <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                      {d.date.slice(5).replace("-", "/")} · {d.count}건
                    </span>
                    <div
                      className="w-full max-w-[22px] rounded-t-[4px]"
                      style={{
                        background: "var(--blue)",
                        height: `${(d.count / max) * 100}%`,
                        minHeight: d.count > 0 ? 3 : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between mt-1 text-sub text-[11px]">
              <span>{data.daily[0]?.date.slice(5).replace("-", "/")}</span>
              <span>{data.daily[data.daily.length - 1]?.date.slice(5).replace("-", "/")}</span>
            </div>
          </section>

          {/* 낮은 평점 답변 */}
          <section className="rise d3 card p-5 flex flex-col gap-2">
            <h2 className="font-bold text-[15px]">아쉬웠던 답변</h2>
            {data.lowRated.length === 0 ? (
              <p className="text-sub text-[14px] py-3 text-center">낮은 평가를 받은 답변이 없어요</p>
            ) : (
              data.lowRated.map((r, i) => (
                <div key={i} className="rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
                  <p className="text-[13px] font-bold mb-0.5">Q. {r.question || "(질문 없음)"}</p>
                  <p className="text-sub text-[13px] truncate">A. {r.answer}…</p>
                </div>
              ))
            )}
          </section>

          {/* 자료 공백 */}
          <section className="rise d4 card p-5 flex flex-col gap-2">
            <h2 className="font-bold text-[15px]">자료가 부족했던 질문</h2>
            <p className="text-sub text-[13px] -mt-1">
              근거 자료 없이 답했거나 관련도가 낮았어요 — 이 주제 자료를 추가해 보세요.
            </p>
            {data.weak.length === 0 ? (
              <p className="text-sub text-[14px] py-3 text-center">자료 공백이 발견되지 않았어요</p>
            ) : (
              data.weak.map((w, i) => (
                <div key={i} className="rounded-[14px] border border-line p-3 flex justify-between gap-2" style={{ background: "var(--fill-2)" }}>
                  <p className="text-[13px] min-w-0 truncate">{w.question || "(질문 없음)"}</p>
                  <span className="text-sub text-[12px] shrink-0">{w.reason}</span>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
