// 평가 결과 CSV 셀프체크 (외부 API·DB 불필요).
// 실행: npx tsx scripts/test-results-csv.ts
import { toCsv, csvCell, kstStamp, CSV_HEADER, type ResultRow } from "../src/lib/results-csv";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, note = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${note ? ` — ${note}` : ""}`);
  }
}

const row: ResultRow = {
  submittedAt: "2026-08-18T00:24:11.000Z",
  academy: "마스터 전산회계 학원",
  teacher: "김대차",
  assessment: "3월 모의고사",
  student: "홍길동",
  score: 2,
  total: 3,
  percent: 67,
  signedAt: "2026-08-18T00:24:11.000Z",
  marks: "OXO",
};

console.log("\n── 시각 변환 (KST)");
ok("UTC 00:24 → KST 09:24", kstStamp("2026-08-18T00:24:11.000Z") === "2026-08-18 09:24", kstStamp("2026-08-18T00:24:11.000Z"));
ok("빈 값은 빈 문자열", kstStamp("") === "");
ok("잘못된 값도 빈 문자열", kstStamp("nope") === "");

console.log("\n── 셀 이스케이프");
ok("쉼표 있으면 따옴표로 감쌈", csvCell("가,나") === '"가,나"', csvCell("가,나"));
ok("따옴표는 두 번으로", csvCell('그는 "안녕"') === '"그는 ""안녕"""', csvCell('그는 "안녕"'));
ok("줄바꿈 있으면 감쌈", csvCell("가\n나") === '"가\n나"');
ok("평범한 값은 그대로", csvCell("김대차") === "김대차");
ok("숫자도 처리", csvCell(67) === "67");

console.log("\n── CSV 인젝션 방어 (시트가 수식으로 실행하는 것 차단)");
ok("= 로 시작하면 홑따옴표", csvCell("=1+1") === "'=1+1", csvCell("=1+1"));
ok("+ 로 시작하면 홑따옴표", csvCell("+1") === "'+1");
ok("- 로 시작하면 홑따옴표", csvCell("-1") === "'-1");
ok("@ 로 시작하면 홑따옴표", csvCell("@SUM(A1)") === "'@SUM(A1)");
ok(
  "수식+쉼표 조합도 안전",
  csvCell('=HYPERLINK("http://evil","x")') === `"'=HYPERLINK(""http://evil"",""x"")"`,
  csvCell('=HYPERLINK("http://evil","x")')
);

console.log("\n── 전체 변환");
{
  const csv = toCsv([row]);
  const lines = csv.split("\r\n");
  ok("헤더 10칸", lines[0].split(",").length === CSV_HEADER.length, `${lines[0].split(",").length}칸`);
  ok("헤더 한글", lines[0].startsWith("제출시각,학원,강사,평가명,학생"), lines[0].slice(0, 30));
  ok("데이터 1행", lines.length === 2, `${lines.length}줄`);
  ok("점수·정답률 포함", lines[1].includes(",2,3,67,"), lines[1]);
  ok("문항별 정오 포함", lines[1].endsWith("OXO"), lines[1].slice(-12));
  ok("CRLF 줄바꿈", csv.includes("\r\n"));
}

console.log("\n── 서명 없는 응시");
{
  const csv = toCsv([{ ...row, signedAt: "" }]);
  ok("서명 없으면 '없음'", csv.includes(",없음,"), csv.split("\r\n")[1]);
}

console.log("\n── 빈 결과");
{
  const csv = toCsv([]);
  ok("헤더만 남음", csv.split("\r\n").length === 1);
}

console.log("\n── 사용자 입력이 섞인 이름");
{
  const csv = toCsv([{ ...row, student: '=cmd|"/c calc"!A1', assessment: "1학기, 중간고사" }]);
  const line = csv.split("\r\n")[1];
  ok("악성 이름 무력화", line.includes("'=cmd"), line.slice(0, 60));
  ok("쉼표 든 평가명 안전", line.includes('"1학기, 중간고사"'));
}

console.log("\n" + "=".repeat(50));
console.log(`통과 ${pass} · 실패 ${fails.length}`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
