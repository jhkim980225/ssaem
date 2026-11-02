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
  const { session, gate, allowed } = useGate("teacher");
  const [data, setData] = useState<Insights | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed || !session) return;
    fetch("/api/insights", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch(() => setErr("불러오기 실패"));
  }, [allowed, session]);

  if (gate) return gate;

  const max = Math.max(1, ...(data?.daily.map((d) => d.count) ?? [1]));

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">인사이트</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">최근 {data?.days ?? 14}일 학생 질문과 답변 품질이에요.</p>
      </div>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {!data && !err && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-24 !rounded-[16px]" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* 스탯 타일 */}
          <div className="rise d1 grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
            {(
              [
                ["질문", data.totals.questions, undefined],
                ["답변", data.totals.answers, undefined],
                ["도움됨", data.totals.up, "var(--blue)"],
                ["아쉬움", data.totals.down, "var(--red)"],
              ] as const
            ).map(([label, n, color]) => (
              <div key={label} className="card !rounded-[14px] p-4 lg:px-5 lg:py-[18px]">
                <p className="text-sub text-[13px] lg:text-[14px]">{label}</p>
                <p className="text-[24px] lg:text-[28px] font-bold tabular-nums mt-1" style={color ? { color } : undefined}>
                  {n}
                </p>
              </div>
            ))}
          </div>

          {/* 일별 질문 추이 — 단일 시리즈 막대 (범례 불필요). 가장 많은 날만 진하게 */}
          <section className="rise d2 card p-5 lg:p-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-bold text-[17px] lg:text-[19px]">일별 질문 수</h2>
              <span className="text-sub text-[13px]">최대 {max}건</span>
            </div>
            {data.totals.questions === 0 ? (
              <p className="text-sub text-[14px] py-6 text-center">아직 질문이 없어요.</p>
            ) : (
              <div className="flex items-end gap-1 lg:gap-2 h-36 lg:h-44" role="img" aria-label="일별 질문 수 막대 그래프">
                {data.daily.map((d) => (
                  <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                    <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                      {d.date.slice(5).replace("-", "/")} · {d.count}건
                    </span>
                    <div
                      className="w-full rounded-t-[6px] rounded-b-[2px]"
                      style={{
                        background: "var(--blue)",
                        opacity: d.count === max ? 1 : 0.22,
                        height: `${(d.count / max) * 100}%`,
                        minHeight: d.count > 0 ? 3 : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between mt-2 text-sub text-[12px]">
              <span>{data.daily[0]?.date.slice(5).replace("-", "/")}</span>
              <span>{data.daily[data.daily.length - 1]?.date.slice(5).replace("-", "/")}</span>
            </div>
          </section>

          {/* 아래 두 카드는 PC에서 나란히 — 각각 목록이 짧아 세로로 쌓으면 여백만 커진다 */}
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
          {/* 낮은 평점 답변 */}
          <section className="rise d3 card p-5 lg:p-6 flex flex-col min-w-0">
            <h2 className="font-bold text-[17px] lg:text-[19px] mb-3">아쉬웠던 답변</h2>
            {data.lowRated.length === 0 ? (
              <p className="text-sub text-[14px] py-4 text-center border-t border-line">낮은 평가를 받은 답변이 없어요</p>
            ) : (
              data.lowRated.map((r, i) => (
                <div key={i} className="py-3.5 border-t border-line min-w-0">
                  <p className="text-[15px] font-bold mb-1 break-words">
                    <span className="text-blue">Q.</span> {r.question || "(질문 없음)"}
                  </p>
                  <p className="text-[14px] leading-relaxed truncate" style={{ color: "var(--sub-2)" }}>
                    <b>A.</b> {r.answer}…
                  </p>
                </div>
              ))
            )}
          </section>

          {/* 자료 공백 */}
          <section className="rise d4 card p-5 lg:p-6 flex flex-col min-w-0">
            <h2 className="font-bold text-[17px] lg:text-[19px]">자료가 부족했던 질문</h2>
            <p className="text-sub text-[13px] mt-1 mb-3">
              근거 자료 없이 답했거나 관련도가 낮았어요 — 이 주제 자료를 추가해 보세요.
            </p>
            {data.weak.length === 0 ? (
              <p className="text-sub text-[14px] py-4 text-center border-t border-line">자료 공백이 발견되지 않았어요</p>
            ) : (
              data.weak.map((w, i) => (
                <div key={i} className="py-3.5 border-t border-line flex items-start gap-2.5 min-w-0">
                  <span
                    className="inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold shrink-0"
                    style={{ background: "var(--fill)", color: "var(--sub-2)" }}
                  >
                    {w.reason}
                  </span>
                  <p className="text-[15px] min-w-0 break-words">{w.question || "(질문 없음)"}</p>
                </div>
              ))
            )}
          </section>
          </div>
        </>
      )}
    </main>
  );
}
