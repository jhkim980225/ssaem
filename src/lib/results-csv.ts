// 평가 결과 → CSV. 구글시트·엑셀에 그대로 붙여넣을 수 있게 만든다.
//
// 컬럼은 나중에 학원이 원하는 양식으로 바꾸기 쉽게 이 파일 한 곳에만 둔다.
// (시트 자동 전송을 붙일 때도 같은 행 정의를 재사용한다)

export type ResultRow = {
  submittedAt: string;
  academy: string;
  teacher: string;
  assessment: string;
  student: string;
  score: number;
  total: number;
  percent: number;
  signedAt: string; // 빈 문자열 = 서명 없음
  marks: string; // 문항별 정오 (O=정답, X=오답, -=미응답)
};

export const CSV_HEADER = [
  "제출시각",
  "학원",
  "강사",
  "평가명",
  "학생",
  "점수",
  "총점",
  "정답률(%)",
  "서명",
  "문항별정오",
] as const;

/** 한국 시간(KST) 'YYYY-MM-DD HH:MM' — 시트에서 바로 읽히는 형식 */
export function kstStamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const k = new Date(d.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/**
 * CSV 한 칸 이스케이프.
 * 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 내부 따옴표는 두 번 쓴다(RFC 4180).
 * 또 '=' '+' '-' '@'로 시작하는 값은 시트가 **수식으로 해석**하므로 앞에 홑따옴표를 붙인다
 * (CSV 인젝션 방어 — 이름·평가명에 사용자 입력이 들어온다).
 */
export function csvCell(v: string | number): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ResultRow[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        kstStamp(r.submittedAt),
        r.academy,
        r.teacher,
        r.assessment,
        r.student,
        r.score,
        r.total,
        r.percent,
        r.signedAt ? kstStamp(r.signedAt) : "없음",
        r.marks,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  // 엑셀은 CRLF를 기대한다 (구글시트는 둘 다 읽는다)
  return lines.join("\r\n");
}
