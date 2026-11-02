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
      <div className="flex items-center justify-between text-[14px] mb-1.5">
        <span className="truncate">{label}</span>
        <span className="tabular-nums shrink-0 ml-2">
          <b>{rate}%</b> <span className="text-sub text-[12px]">({attempts}문제)</span>
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
    <div className="flex flex-col gap-5">
      {/* 전체 정답률 — 숫자 + 맞음/틀림 막대 */}
      <div>
        <p className="text-sub text-[14px]">전체 정답률</p>
        <p className="text-[34px] font-bold tabular-nums leading-tight mt-1 mb-3.5" style={{ color: rateColor(t.rate) }}>
          {t.rate}
          <span className="text-[20px]">%</span>
        </p>
        <div className="h-2.5 rounded-full overflow-hidden flex gap-0.5" style={{ background: "var(--fill)" }}>
          <div className="h-full" style={{ width: `${t.rate}%`, background: "var(--blue)" }} />
          <div className="h-full flex-1" style={{ background: "var(--red-weak)" }} />
        </div>
        <p className="text-sub text-[13px] mt-2 tabular-nums">
          맞음 <b className="text-blue">{t.correct}</b> · 틀림 <b style={{ color: "var(--red)" }}>{t.wrong}</b> · 총 {t.attempts}문제
        </p>
      </div>

      {stats.bySubject.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[15px] font-bold">과목별 정답률</h3>
          {stats.bySubject.map((s) => (
            <RateBar key={s.subject} label={s.subject} rate={s.rate} attempts={s.attempts} />
          ))}
        </div>
      )}

      {stats.byTag.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[15px] font-bold">
            유형별 정답률 <span className="text-sub text-[13px] font-normal">많이 푼 순</span>
          </h3>
          {stats.byTag.map((x) => (
            <RateBar key={x.tag} label={x.tag} rate={x.rate} attempts={x.attempts} />
          ))}
        </div>
      )}
    </div>
  );
}
