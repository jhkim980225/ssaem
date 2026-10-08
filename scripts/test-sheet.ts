// 엑셀 연습장 수식 엔진(src/lib/sheet.ts) 셀프체크. 외부 키·서버 불필요.
//   npx tsx scripts/test-sheet.ts
//
// 1) 단위 검증 — 엑셀 실제 결과와 대조한 값 (연산 우선순위·반올림·날짜·조건·D함수 등)
// 2) 기출 교차 검증 — 컴활2급 기출 보기 중 "=수식 ⇒ 결과" 꼴(셀 참조 없는 것)을 엔진으로 계산해
//    정답표와 맞는지 본다. "옳지 않은 것" 문항이면 정답 보기만 어긋나야 하고, "옳은 것"이면 정답 보기만
//    맞아야 한다. 소스(acct_quiz 산출물)가 없으면 건너뛴다.
import { readFileSync, existsSync } from "node:fs";
import { Sheet, parseFormula, FormulaError, toSerial, formatValue, shiftFormula, cycleRef, fillSeries, funcContext, type Cells, type Scalar } from "../src/lib/sheet";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function val(formula: string, cells: Cells = {}): Scalar {
  const s = new Sheet({ ...cells, Z200: formula });
  return s.value(199, 25);
}
function show(formula: string, cells: Cells = {}): string {
  const s = new Sheet({ ...cells, Z200: formula });
  return s.display(199, 25).text;
}
function eq(formula: string, want: Scalar | string, cells: Cells = {}) {
  const got = val(formula, cells);
  const g = got instanceof Object && "code" in got ? got.code : got;
  const same = typeof want === "number" && typeof g === "number" ? Math.abs(g - want) < 1e-9 : g === want;
  ok(formula, same, `기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(g)}`);
}

console.log("1) 단위 검증");
// 연산자
eq("=1+2*3", 7);
eq("=(1+2)*3", 9);
eq("=-2^2", 4); // 엑셀: 음수 부호가 ^보다 먼저
eq("=2^3^2", 64); // 왼쪽부터
eq("=10%", 0.1);
eq('="a"&1&TRUE', "a1TRUE");
eq("=1/0", "#DIV/0!");
eq('="3"+4', 7);
eq('="abc"+1', "#VALUE!");
eq("=A1+1", 1); // 빈 칸 = 0
eq("=A1", 0);
eq('=1="1"', false);
eq('="ABC"="abc"', true);
eq("=5>\"a\"", false); // 숫자 < 글자
// 반올림 계열 — 컴활 단골
eq("=ROUND(4561.604,1)", 4561.6);
eq("=ROUND(4561.604,-1)", 4560);
eq("=ROUNDUP(4561.604,1)", 4561.7);
eq("=ROUNDUP(4561.604,-1)", 4570);
eq("=ROUNDDOWN(4561.604,-2)", 4500);
eq("=ROUND(2.5,0)", 3);
eq("=ROUND(-2.5,0)", -3);
eq("=ROUND(1.005,2)", 1.01);
eq("=ROUNDUP(1.1,1)", 1.1);
eq("=INT(-7.4)", -8);
eq("=TRUNC(-8.6)", -8);
eq("=MOD(13,-3)", -2);
eq("=MOD(-13,3)", 2);
eq("=POWER(3,2)", 9);
eq("=ABS(-3)", 3);
eq("=QUOTIENT(7,2)", 3);
// 집계
const data: Cells = { A1: "10", A2: "20", A3: "abc", A4: "", A5: "TRUE", B1: "1", B2: "2", B3: "3", B4: "4", B5: "5" };
eq("=SUM(A1:A5)", 30, data); // 범위 안 글자·논리값 무시
eq("=SUM(10,TRUE)", 11); // 직접 쓴 논리값은 센다
eq("=AVERAGE(A1:A5)", 15, data);
eq("=AVERAGEA(A1:A5)", 31 / 4, data); // 글자 0, TRUE 1
eq("=COUNT(A1:A5)", 2, data);
eq("=COUNTA(A1:A5)", 4, data);
eq("=COUNTBLANK(A1:A5)", 1, data);
eq("=MAX(B1:B5)", 5, data);
eq("=LARGE(B1:B5,2)", 4, data);
eq("=SMALL(B1:B5,2)", 2, data);
eq("=MEDIAN(B1:B4)", 2.5, data);
eq("=MODE(1,2,2,3,3)", 2); // 횟수 같으면 먼저 나온 값
eq("=RANK(4,B1:B5)", 2, data);
eq("=RANK(4,B1:B5,1)", 4, data);
eq("=SUMPRODUCT(B1:B3,B3:B5)", 1 * 3 + 2 * 4 + 3 * 5, data);
// 조건
const sc: Cells = {
  A1: "이름", B1: "점수", C1: "부서",
  A2: "김철수", B2: "85", C2: "영업",
  A3: "이영희", B3: "92", C3: "기획",
  A4: "김민수", B4: "70", C4: "영업",
  A5: "박지성", B5: "", C5: "영업부",
};
eq('=COUNTIF(B2:B5,">=80")', 2, sc);
eq('=COUNTIF(A2:A5,"김*")', 2, sc);
eq('=COUNTIF(C2:C5,"영업")', 2, sc); // 일반 조건은 완전 일치 (영업부 제외)
eq('=COUNTIF(B2:B5,"<>")', 3, sc);
eq('=COUNTIF(B2:B5,"")', 1, sc);
eq('=SUMIF(C2:C5,"영업",B2:B5)', 155, sc);
eq('=AVERAGEIF(C2:C5,"영업",B2:B5)', 77.5, sc);
eq('=COUNTIFS(C2:C5,"영업",B2:B5,">80")', 1, sc);
eq('=SUMIFS(B2:B5,C2:C5,"영업",A2:A5,"김*")', 155, sc);
// D함수 — 조건 글자는 앞글자 일치 ("영업" → 영업부도 포함)
const db: Cells = { ...sc, E1: "부서", E2: "영업", F1: "점수", F2: ">=80" };
eq("=DSUM(A1:C5,2,E1:E2)", 155, db);
eq('=DSUM(A1:C5,"점수",E1:E2)', 155, db);
eq("=DCOUNT(A1:C5,2,E1:E2)", 2, db); // 영업부 박지성은 점수 빈 칸
eq("=DCOUNTA(A1:C5,1,E1:E2)", 3, db);
eq("=DAVERAGE(A1:C5,2,E1:F2)", 85, db); // 영업 AND 80 이상
eq("=DMAX(A1:C5,2,E1:E2)", 85, db);
// 찾기
const lk: Cells = { A1: "코드", B1: "이름", A2: "A", B2: "사과", A3: "B", B3: "배", A4: "C", B4: "감", D1: "0", E1: "F", D2: "60", E2: "D", D3: "70", E3: "C", D4: "80", E4: "B", D5: "90", E5: "A" };
eq('=VLOOKUP("B",A2:B4,2,FALSE)', "배", lk);
eq('=VLOOKUP("Z",A2:B4,2,0)', "#N/A", lk);
eq("=VLOOKUP(85,D1:E5,2)", "B", lk);
eq("=VLOOKUP(85,D1:E5,2,TRUE)", "B", lk);
eq("=VLOOKUP(85,D1:E5,3)", "#REF!", lk);
eq('=HLOOKUP("이름",A1:B4,3,FALSE)', "배", lk);
eq('=MATCH("C",A2:A4,0)', 3, lk);
eq("=MATCH(75,D1:D5,1)", 3, lk);
eq("=INDEX(A2:B4,2,2)", "배", lk);
eq("=INDEX(D1:E5,MATCH(90,D1:D5,0),2)", "A", lk);
eq('=CHOOSE(2,"월","화","수")', "화");
eq("=ROW(C7)", 7);
eq("=COLUMNS(A1:D1)", 4);
// 논리
eq('=IF(85>=80,"합격","불합격")', "합격");
eq("=IF(FALSE,1)", false);
eq("=AND(TRUE,1)", true);
eq("=OR(FALSE,0)", false);
eq("=NOT(TRUE)", false);
eq('=IFERROR(1/0,"오류")', "오류");
eq('=IFERROR(VLOOKUP("Z",A2:B4,2,0),"없음")', "없음", lk);
eq('=IFERROR(SUM("a"),"x")', "x");
eq('=IFS(70>=90,"A",70>=70,"B")', "B");
eq('=SWITCH(2,1,"하나",2,"둘","기타")', "둘");
eq("=ISBLANK(A1)", true);
eq("=ISERROR(1/0)", true);
eq("=ISEVEN(4)", true);
// 문자
eq('=LEFT(MID("Sound of Music",5,6),3)', "d o");
eq('=MID(RIGHT("Sound of Music",7),2,3)', " Mu");
eq('=RIGHT(MID("Sound of Music",3,7),3)', "of ");
eq('=MID(LEFT("Sound of Music",7),2,3)', "oun");
eq('=LEN("컴활 2급")', 5);
eq('=UPPER("abc")', "ABC");
eq('=PROPER("hello world")', "Hello World");
eq('=TRIM("  a   b  ")', "a b");
eq('=REPLACE("abcdef",2,3,"X")', "aXef");
eq('=SUBSTITUTE("a-b-c","-","+")', "a+b+c");
eq('=SUBSTITUTE("a-b-c","-","+",2)', "a-b+c");
eq('=FIND("b","ABCb")', 4);
eq('=SEARCH("b","ABCb")', 2);
eq('=FIND("z","abc")', "#VALUE!");
eq('=REPT("♣",3)', "♣♣♣");
eq('=CONCATENATE("컴","활")', "컴활");
eq('=VALUE("1,234")', 1234);
eq('=EXACT("a","A")', false);
// TEXT·표시 형식
eq('=TEXT(1234.5,"#,##0")', "1,235");
eq('=TEXT(1234.5,"#,##0.00")', "1,234.50");
eq('=TEXT(0.256,"0.0%")', "25.6%");
eq('=TEXT(5,"000")', "005");
eq('=TEXT(1234567,"#,##0,")', "1,235");
eq('=TEXT(DATE(2020,7,4),"yyyy-mm-dd")', "2020-07-04");
eq('=TEXT(DATE(2020,7,4),"yyyy년 m월 d일 aaaa")', "2020년 7월 4일 토요일");
eq('=TEXT(DATE(2020,7,4),"ddd")', "Sat");
eq('=TEXT(TIME(14,5,0),"hh:mm AM/PM")', "02:05 PM");
eq('=TEXT(1234,"0원")', "1234원");
ok("서식 음수 구역", formatValue(-5, '0;"△"0') === "△5", String(formatValue(-5, '0;"△"0')));
ok("서식 0 구역", formatValue(0, '0;-0;"없음"') === "없음");
// 날짜
eq("=DATE(2020,7,4)", toSerial(2020, 7, 4));
ok("1900 일련번호", toSerial(1900, 1, 1) === 1 && toSerial(1900, 3, 1) === 61 && toSerial(2020, 7, 4) === 44016);
eq("=YEAR(44016)", 2020);
eq("=MONTH(44016)", 7);
eq("=DAY(44016)", 4);
eq("=WEEKDAY(44016)", 7); // 토요일
eq("=WEEKDAY(44016,2)", 6);
eq("=WEEKDAY(44016,3)", 5);
eq("=DAYS(DATE(2020,12,25),DATE(2020,7,4))", 174);
eq("=EDATE(DATE(2020,1,31),1)", toSerial(2020, 2, 29));
eq("=EOMONTH(DATE(2020,7,4),0)", toSerial(2020, 7, 31));
eq("=WORKDAY(DATE(2020,7,3),1)", toSerial(2020, 7, 6)); // 금 → 다음 월
eq('=DATE(2020,7,4)-"2020-07-01"', 3);
eq("=HOUR(TIME(14,30,15))", 14);
eq("=MINUTE(TIME(14,30,15))", 30);
ok("날짜 칸 표시", show("=DATE(2020,7,4)") === "2020-07-04", show("=DATE(2020,7,4)"));
ok("날짜+1 표시", show("=A1+1", { A1: "2020-07-04" }) === "2020-07-05", show("=A1+1", { A1: "2020-07-04" }));
ok("날짜-날짜는 일수", show("=A2-A1", { A1: "2020-07-01", A2: "2020-07-04" }) === "3");
ok("백분율 입력 표시", new Sheet({ A1: "50%" }).display(0, 0).text === "50%");
ok("큰 수 지수 표기", show("=10^12") === "1E+12", show("=10^12"));
ok("1/3 표시", show("=1/3") === "0.3333333333", show("=1/3"));
// 오류·순환·파싱
eq("=A1", "#CIRC!", { A1: "=A1" });
eq("=A1+1", "#CIRC!", { A1: "=Z200" });
eq("=FOO(1)", "#NAME?");
eq("=OFFSET(A1,1,1)", "#NAME?");
eq("=abc", "#NAME?");
for (const bad of ["SUM(1", "1+", "SUM(1))", '"abc', "“abc”", "Sheet1!A1", "1:1"])
  ok(`파싱 오류: =${bad}`, (() => { try { parseFormula(bad); return false; } catch (e) { return e instanceof FormulaError; } })());
eq("=SUM(A:A)", 6, { A1: "1", A2: "2", A150: "3" });
eq("={1,2;3,4}", "#VALUE!");
eq("=SUM({1,2;3,4})", 10);
eq("=SUM((B1:B3>1)*B1:B3)", 5, data);

// 복사·채우기·F4
ok("상대 참조 이동", shiftFormula("=A1+$B$1+C$2+$D3", 2, 1) === "=B3+$B$1+D$2+$D5", shiftFormula("=A1+$B$1+C$2+$D3", 2, 1));
ok("함수 이름은 안 건드림", shiftFormula("=LOG10(A1)+SUM(B2:B3)", 1, 0) === "=LOG10(A2)+SUM(B3:B4)", shiftFormula("=LOG10(A1)+SUM(B2:B3)", 1, 0));
ok("문자열 안은 안 건드림", shiftFormula('=A1&"A1"', 1, 0) === '=A2&"A1"');
ok("시트 밖 → #REF!", shiftFormula("=A1", -1, 0) === "=#REF!");
ok("F4 순환", ["=A1", "=$A$1", "=A$1", "=$A1"].every((s, i, arr) => cycleRef(s, 2)?.text === arr[(i + 1) % 4]));
ok("채우기: 숫자 한 칸은 복사", fillSeries(["5"], 2, { dr: 1, dc: 0 }).join() === "5,5");
ok("채우기: 숫자 두 칸은 등차", fillSeries(["1", "3"], 3, { dr: 1, dc: 0 }).join() === "5,7,9");
ok("채우기: 날짜는 하루씩", fillSeries(["2020-07-04"], 2, { dr: 1, dc: 0 }).join() === "2020-07-05,2020-07-06");
ok("채우기: 끝 숫자 증가", fillSeries(["A-1"], 2, { dr: 1, dc: 0 }).join() === "A-2,A-3" && fillSeries(["1월"], 1, { dr: 1, dc: 0 })[0] === "2월");
ok("채우기: 사용자 지정 목록", fillSeries(["월"], 2, { dr: 1, dc: 0 }).join() === "화,수" && fillSeries(["갑"], 1, { dr: 1, dc: 0 })[0] === "을" && fillSeries(["자"], 1, { dr: 1, dc: 0 })[0] === "축");
// 2020년 2회 29번: [A1:D1] 가·갑·월·자를 아래로 끌면 같은 값으로 채워지는 것은 "가"
ok("기출 2020-2-29 채우기", fillSeries(["가"], 1, { dr: 1, dc: 0 })[0] === "가");
ok("채우기: 수식은 상대 이동", fillSeries(["=A1*2"], 2, { dr: 1, dc: 0 }).join() === "=A2*2,=A3*2");
ok("채우기: 오른쪽", fillSeries(["=A$1+$B2"], 1, { dr: 0, dc: 1 })[0] === "=B$1+$B2");
ok("함수 도움말 위치", JSON.stringify(funcContext('=VLOOKUP(A1,B1:C5,')) === '{"name":"VLOOKUP","arg":2}');
ok("함수 도움말 — 문자열 안 쉼표 무시", funcContext('=IF(A1="a,b",')?.arg === 1);

console.log("2) 기출 교차 검증 (컴활2급 \"수식 ⇒ 결과\" 보기)");
const SRC = process.env.BANK_SRC_CU || "C:/dev/acct_quiz/pipeline/out/comhwal2/questions.json";
if (!existsSync(SRC)) console.log(`  (건너뜀 — ${SRC} 없음)`);
else {
  type Q = { source: string; seq: number; stem: string; choices: string[]; answer_idx: number };
  const qs = JSON.parse(readFileSync(SRC, "utf-8")) as Q[];
  const RE = /^(=[^⇒→]+?)\s*(?:⇒|→|=>)\s*(.+)$/;
  let checked = 0;
  let agree = 0;
  for (const q of qs) {
    const parsed = q.choices.map((c) => c.match(RE));
    // 네 보기 전부 "수식 ⇒ 글 결과"이고 셀 참조·이름 정의(범위1 같은 한글 이름)가 없는 문항만
    // — 참조가 있으면 시트 그림이 필요하다
    const refy = (f: string) => {
      const bare = f.replace(/"[^"]*"/g, "");
      return /\b\$?[A-Z]{1,2}\$?\d+\b/.test(bare) || /[가-힣]/.test(bare);
    };
    if (parsed.some((m) => !m || m[2].includes("[[그림]]") || refy(m[1]))) continue;
    const negative = /않은|틀린|잘못/.test(q.stem);
    const right = parsed.map((m) => {
      const got = show(m![1].trim());
      const want = m![2].trim().replace(/^"(.*)"$/, "$1");
      return got === want || (Number(got.replace(/,/g, "")) === Number(want.replace(/,/g, "")) && want !== "" && !isNaN(Number(want.replace(/,/g, ""))));
    });
    const expect = q.choices.map((_, i) => (negative ? i !== q.answer_idx : i === q.answer_idx));
    checked++;
    const same = right.every((r, i) => r === expect[i]);
    if (same) agree++;
    else
      console.log(
        `  ✗ ${q.source} ${q.seq}번 (${negative ? "옳지 않은" : "옳은"} 것, 정답 ${q.answer_idx + 1}) ` +
          parsed.map((m, i) => `\n      ${i + 1}) ${m![1].trim()} ⇒ 기대 ${m![2].trim()} · 엔진 ${show(m![1].trim())}`).join("")
      );
  }
  ok(`기출 ${checked}문항 정답표와 일치`, agree === checked, `${agree}/${checked}`);
  console.log(`  ${agree}/${checked}문항 일치`);
}

console.log(`\n${fail ? "❌" : "✅"} ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
