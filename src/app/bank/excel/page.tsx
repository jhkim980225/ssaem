"use client";
import { useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import ExcelPad from "@/components/ExcelPad";
import { FUNC_HELP, type Cells } from "@/lib/sheet";

// 엑셀 연습장 — 컴활 2과목(스프레드시트 일반) 함수·참조를 문제 밖에서 자유롭게 연습한다.
// 시트는 이 브라우저에만 저장된다(다른 기기·계정과 공유 안 됨). 처음 열면 성적표 예제가 깔려 있다.

const KEY = "ssaem:excel-pad";
const ROWS = 30;
const COLS = 12;

// 예제 — 성적표. 합계·평균·순위·판정은 2행 수식을 아래로 채운 것과 같다(상대·절대 참조 확인용)
const PEOPLE: [string, string, number, number][] = [
  ["김철수", "1반", 85, 90],
  ["이영희", "2반", 92, 88],
  ["박민수", "1반", 70, 65],
  ["최지은", "2반", 88, 95],
  ["정우성", "1반", 60, 72],
];
const EXAMPLE: Cells = (() => {
  const c: Cells = { A1: "이름", B1: "반", C1: "국어", D1: "영어", E1: "합계", F1: "평균", G1: "순위", H1: "판정" };
  PEOPLE.forEach(([n, b, k, e], i) => {
    const r = i + 2;
    Object.assign(c, {
      [`A${r}`]: n,
      [`B${r}`]: b,
      [`C${r}`]: String(k),
      [`D${r}`]: String(e),
      [`E${r}`]: `=SUM(C${r}:D${r})`,
      [`F${r}`]: `=AVERAGE(C${r}:D${r})`,
      [`G${r}`]: `=RANK.EQ(E${r},$E$2:$E$6)`,
      [`H${r}`]: `=IF(F${r}>=80,"우수",IF(F${r}>=70,"보통","노력"))`,
    });
  });
  Object.assign(c, {
    J1: "반",
    J2: "1반",
    J4: "1반 국어 합계",
    K4: '=DSUM(A1:H6,"국어",J1:J2)',
    J5: "80점 이상 인원",
    K5: '=COUNTIF(F2:F6,">=80")',
    J7: "찾을 이름",
    K7: "이영희",
    J8: "영어 점수",
    K8: "=VLOOKUP(K7,A2:D6,4,FALSE)",
  });
  return c;
})();

// 컴활2급 출제 기준의 함수 범주
const GROUPS: [string, string[]][] = [
  ["수학·삼각", ["SUM", "SUMIF", "SUMIFS", "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "INT", "MOD", "ABS", "POWER", "SQRT", "SUMPRODUCT", "RAND", "RANDBETWEEN"]],
  ["통계", ["AVERAGE", "AVERAGEA", "AVERAGEIF", "AVERAGEIFS", "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "MAX", "MIN", "LARGE", "SMALL", "MEDIAN", "MODE.SNGL", "RANK.EQ", "STDEV.S", "VAR.S"]],
  ["논리", ["IF", "IFS", "IFERROR", "AND", "OR", "NOT", "SWITCH"]],
  ["문자열", ["LEFT", "RIGHT", "MID", "LEN", "UPPER", "LOWER", "PROPER", "TRIM", "REPLACE", "SUBSTITUTE", "FIND", "SEARCH", "CONCAT", "REPT", "TEXT", "VALUE"]],
  ["날짜·시간", ["TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "TIME", "HOUR", "MINUTE", "SECOND", "WEEKDAY", "DAYS", "EDATE", "EOMONTH", "WORKDAY"]],
  ["찾기·참조", ["VLOOKUP", "HLOOKUP", "MATCH", "INDEX", "CHOOSE"]],
  ["데이터베이스", ["DSUM", "DAVERAGE", "DCOUNT", "DCOUNTA", "DMAX", "DMIN"]],
];

export default function ExcelPadPage() {
  const { gate } = useGate("any", { loginMessage: "엑셀 연습장은 로그인 후 쓸 수 있어요." });
  const [ver, setVer] = useState(0); // 예제 다시 깔기 — 연습장을 새로 그린다

  function loadExample() {
    if (!confirm("지금 시트를 지우고 성적표 예제를 다시 깔까요?")) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(EXAMPLE));
    } catch {
      /* 저장소가 막혀 있어도 아래 initial로 예제가 깔린다 */
    }
    setVer((v) => v + 1);
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-[1240px] mx-auto px-4 lg:px-6 py-8 flex flex-col gap-4">
      <div className="rise flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">엑셀 연습장</h1>
          <p className="text-sub text-[14px] break-keep">
            컴활 2과목 함수·참조를 직접 넣어 보며 익혀요. 시트는 이 기기의 브라우저에 저장돼요.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:shrink-0">
          <button onClick={loadExample} className="chip !text-[13px]">
            예제 다시 깔기
          </button>
          <Link href="/bank" className="chip !text-[13px]">
            기출문제
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section className="rise d1 card p-4 lg:p-5 min-w-0">
          <ExcelPad key={ver} rows={ROWS} cols={COLS} storageKey={KEY} initial={EXAMPLE} />
        </section>

        <aside className="rise d2 card p-5 flex flex-col gap-3 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-96px)] lg:overflow-auto">
          <h2 className="font-bold text-[15px]">사용법</h2>
          <ul className="text-[13px] leading-relaxed flex flex-col gap-1.5 break-keep" style={{ color: "var(--text-2)" }}>
            <li>칸을 고르고 바로 입력 — 수식은 <b>=</b>로 시작해요.</li>
            <li>수식을 쓰다가 칸을 누르면 주소가, 끌면 범위가 들어가요.</li>
            <li>
              <b>F4</b> — 커서가 있는 주소를 A1 → $A$1 → A$1 → $A1로 바꿔요.
            </li>
            <li>선택 칸 오른쪽 아래 <b>채우기 핸들</b>을 끌면 수식이 상대 참조로 복사되고, 월·화·수나 갑·을·병처럼 이어지는 값은 다음 값이 채워져요.</li>
            <li>칸 여러 개를 끌어 고르면 아래에 평균·개수·합계가 보여요.</li>
            <li>
              Ctrl+C / Ctrl+V(참조가 옮겨 붙어요), Ctrl+D(아래로 채우기), Delete(지우기), F2(고치기)
            </li>
          </ul>
          <h2 className="font-bold text-[15px] mt-2">함수 목록</h2>
          <div className="flex flex-col gap-1">
            {GROUPS.map(([g, names]) => (
              <details key={g} className="rounded-[10px] border border-line px-3 py-2">
                <summary className="text-[13px] font-bold cursor-pointer select-none">
                  {g} <span className="text-sub font-normal">{names.length}</span>
                </summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {names.map((n) => (
                    <li key={n} className="text-[12px] leading-snug break-keep" style={{ color: "var(--text-2)" }}>
                      <span className="font-mono">{FUNC_HELP[n] ?? n}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}
