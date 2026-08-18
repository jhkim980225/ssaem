// 구글시트 전송 셀프체크 (실제 전송 없음 — 네트워크·키 불필요).
// 실행: npx tsx scripts/test-sheets.ts
import { toSheetRow, sheetsConfigured, appendResultRows } from "../src/lib/sheets";
import { CSV_HEADER, type ResultRow } from "../src/lib/results-csv";

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

async function main() {
console.log("\n── 행 변환");
{
  const r = toSheetRow(row);
  ok("컬럼 수가 CSV 헤더와 같음", r.length === CSV_HEADER.length, `${r.length} vs ${CSV_HEADER.length}`);
  ok("제출시각 KST 변환", r[0] === "2026-08-18 09:24", String(r[0]));
  ok("학원·강사·평가·학생 순서", r[1] === "마스터 전산회계 학원" && r[2] === "김대차" && r[3] === "3월 모의고사" && r[4] === "홍길동");
  ok("점수는 숫자로 (시트에서 계산 가능하게)", typeof r[5] === "number" && typeof r[6] === "number" && typeof r[7] === "number");
  ok("서명 시각 KST", r[8] === "2026-08-18 09:24", String(r[8]));
  ok("문항별 정오", r[9] === "OXO");
}

console.log("\n── 서명 없는 응시");
{
  const r = toSheetRow({ ...row, signedAt: "" });
  ok("서명 없으면 '없음'", r[8] === "없음", String(r[8]));
}

console.log("\n── 미설정 시 동작 (키 없어도 앱이 죽지 않아야 함)");
{
  // 이 테스트는 env가 비어 있는 상태를 가정한다
  const saved = {
    e: process.env.GOOGLE_SA_EMAIL,
    k: process.env.GOOGLE_SA_PRIVATE_KEY,
    i: process.env.GOOGLE_SHEET_ID,
  };
  delete process.env.GOOGLE_SA_EMAIL;
  delete process.env.GOOGLE_SA_PRIVATE_KEY;
  delete process.env.GOOGLE_SHEET_ID;

  ok("미설정 감지", sheetsConfigured() === false);
  const res = await appendResultRows([row]);
  ok("미설정이면 skipped로 반환(예외 아님)", res.ok === false && res.skipped === true, JSON.stringify(res));

  const empty = await appendResultRows([]);
  ok("빈 배열은 그냥 성공", empty.ok === true);

  if (saved.e) process.env.GOOGLE_SA_EMAIL = saved.e;
  if (saved.k) process.env.GOOGLE_SA_PRIVATE_KEY = saved.k;
  if (saved.i) process.env.GOOGLE_SHEET_ID = saved.i;
}

console.log("\n── 잘못된 키로도 던지지 않아야 함 (제출을 막으면 안 된다)");
{
  process.env.GOOGLE_SA_EMAIL = "fake@fake.iam.gserviceaccount.com";
  process.env.GOOGLE_SA_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nBROKEN\\n-----END PRIVATE KEY-----";
  process.env.GOOGLE_SHEET_ID = "fake-sheet-id";
  const res = await appendResultRows([row]);
  ok("깨진 키여도 예외 대신 ok:false", res.ok === false && Boolean(res.error), (res.error ?? "").slice(0, 40));
  delete process.env.GOOGLE_SA_EMAIL;
  delete process.env.GOOGLE_SA_PRIVATE_KEY;
  delete process.env.GOOGLE_SHEET_ID;
}

console.log("\n" + "=".repeat(50));
console.log(`통과 ${pass} · 실패 ${fails.length}`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
