// 강사 통계의 조회 기간. ?from=YYYY-MM-DD&to=YYYY-MM-DD (한국 날짜, 둘 다 포함) 또는 ?days=N.
// 아무것도 없으면 최근 14일 — 대시보드가 이 기본값을 쓴다.

const KST = 9 * 3_600_000;
const DAY = 86_400_000;
export const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 시각 → 한국 날짜 "YYYY-MM-DD" */
export const kstDate = (t: string | number | Date) => new Date(new Date(t).getTime() + KST).toISOString().slice(0, 10);

export type Period = {
  from: string; // 한국 날짜 (포함)
  to: string; // 한국 날짜 (포함)
  days: number;
  sinceIso: string; // DB 조회용 [sinceIso, untilIso)
  untilIso: string;
};

export function periodOf(req: Request, defDays = 14): Period {
  const q = new URL(req.url).searchParams;
  const today = kstDate(Date.now());
  let to = q.get("to") ?? "";
  let from = q.get("from") ?? "";
  if (!DATE.test(to) || to > today) to = today;
  if (!DATE.test(from)) {
    const n = Math.min(MAX_DAYS, Math.max(1, Number(q.get("days")) || defDays));
    from = kstDate(Date.parse(to) - (n - 1) * DAY);
  }
  if (from > to) from = to;
  // 너무 긴 기간은 끝(to) 기준으로 자른다
  if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > MAX_DAYS) from = kstDate(Date.parse(to) - (MAX_DAYS - 1) * DAY);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  return {
    from,
    to,
    days,
    sinceIso: new Date(Date.parse(from) - KST).toISOString(),
    untilIso: new Date(Date.parse(to) + DAY - KST).toISOString(),
  };
}

/** 기간의 날짜 목록 (from → to) */
export function datesOf(p: Period): string[] {
  const out: string[] = [];
  for (let t = Date.parse(p.from); t <= Date.parse(p.to); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
