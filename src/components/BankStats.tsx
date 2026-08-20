"use client";

// 기출 풀이 통계 차트 — 학생(/my/records)과 강사(기출 이름 검색)가 같이 쓴다.
// 라이브러리 없이 CSS 막대 (인사이트 페이지와 같은 방식).

export type BankStatsData = {
  name: string | null;
  totals: { attempts: number; correct: number; wrong: number; rate: number };
  bySubject: { subject: string; attempts: number; correct: number; rate: number }[];
  byTag: { tag: string; attempts: number; correct: number; rate: number }[];
};

const rateColor = (rate: number) => (rate >= 60 ? "var(--blue)" : "var(--red)");

function RateBar({ label, rate, attempts }: { label: string; rate: number; attempts: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] mb-1">
        <span className="font-medium truncate">{label}</span>
        <span className="text-sub tabular-nums shrink-0 ml-2">
          {rate}% <span className="text-[11px]">({attempts}문제)</span>
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--fill)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(rate, 2)}%`, background: rateColor(rate) }} />
      </div>
    </div>
  );
}

export default function BankStats({ stats }: { stats: BankStatsData }) {
  const t = stats.totals;
  if (t.attempts === 0)
    return <p className="text-sub text-[13px]">아직 풀이 기록이 없어요. 기출문제를 풀면 통계가 쌓여요.</p>;

  return (
    <div className="flex flex-col gap-4">
      {/* 전체 정답률 — 숫자 + 게이지 */}
      <div className="flex items-center gap-4">
        <div className="text-center shrink-0">
          <p className="text-[30px] font-extrabold tabular-nums leading-none" style={{ color: rateColor(t.rate) }}>
            {t.rate}%
          </p>
          <p className="text-sub text-[11px] mt-1">전체 정답률</p>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-[12px] text-sub mb-1">
            <span>
              맞음 <b className="text-blue">{t.correct}</b>
            </span>
            <span>
              틀림 <b style={{ color: "var(--red)" }}>{t.wrong}</b> · 총 {t.attempts}문제
            </span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex" style={{ background: "var(--fill)" }}>
            <div className="h-full" style={{ width: `${t.rate}%`, background: "var(--blue)" }} />
            <div className="h-full" style={{ width: `${100 - t.rate}%`, background: "var(--red-weak)" }} />
          </div>
        </div>
      </div>

      {stats.bySubject.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-sub text-[12px] font-bold">과목별 정답률</p>
          {stats.bySubject.map((s) => (
            <RateBar key={s.subject} label={s.subject} rate={s.rate} attempts={s.attempts} />
          ))}
        </div>
      )}

      {stats.byTag.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <p className="text-sub text-[12px] font-bold">유형별 정답률 (많이 푼 순)</p>
          {stats.byTag.map((x) => (
            <RateBar key={x.tag} label={x.tag} rate={x.rate} attempts={x.attempts} />
          ))}
        </div>
      )}
    </div>
  );
}
