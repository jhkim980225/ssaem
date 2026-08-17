// 평가 파싱·채점 셀프체크 (외부 API·DB 불필요).
// 실행: npx tsx scripts/test-assessment.ts
import * as XLSX from "xlsx";
import { parseAssessmentFile, grade, buildTemplate, MAX_QUESTIONS } from "../src/lib/assessment";

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

/** 2차원 배열 → xlsx 버퍼 */
function xlsxOf(rows: unknown[][]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "s");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}
/** CSV 문자열 → 버퍼 */
function csvOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const HEAD = ["문제", "보기1", "보기2", "보기3", "보기4", "정답", "해설"];
const ROW = ["차변은?", "자산증가", "자산감소", "부채증가", "수익발생", "1", "차변은 자산의 증가"];

console.log("\n── 엑셀 파싱");
{
  const r = parseAssessmentFile(xlsxOf([HEAD, ROW]));
  ok("정상 1문항 파싱", r.questions.length === 1 && r.skipped === 0);
  const q = r.questions[0];
  ok("정답 1 → 0-based 0 변환", q?.answer === 0, `answer=${q?.answer}`);
  ok("보기 4개", q?.choices.length === 4);
  ok("해설 보존", q?.explanation === "차변은 자산의 증가");
}

console.log("\n── CSV 파싱");
{
  const csv = [HEAD.join(","), ROW.join(",")].join("\n");
  const r = parseAssessmentFile(csvOf(csv));
  ok("CSV 1문항 파싱", r.questions.length === 1, `${r.questions.length}문항`);
}

console.log("\n── 깨진 행 스킵");
{
  const rows = [
    HEAD,
    ROW,
    ["보기 부족", "가", "나", "", "", "1", ""],       // 보기 4개 미만
    ["정답 범위 밖", "가", "나", "다", "라", "9", ""], // 1~4 아님
    ["", "가", "나", "다", "라", "1", ""],            // 문제 공백
    ["정답 없음", "가", "나", "다", "라", "", ""],     // 정답 없음
  ];
  const r = parseAssessmentFile(xlsxOf(rows));
  ok("정상 1건만 통과", r.questions.length === 1, `${r.questions.length}문항`);
  ok("깨진 4건 skipped", r.skipped === 4, `skipped=${r.skipped}`);
}

console.log("\n── 정답 표기 관용");
{
  const r = parseAssessmentFile(
    xlsxOf([HEAD, ["표기테스트", "가", "나", "다", "라", "3번", ""]])
  );
  ok("'3번' → 0-based 2", r.questions[0]?.answer === 2, `answer=${r.questions[0]?.answer}`);
}

console.log("\n── 빈 줄·상한");
{
  const rows: unknown[][] = [HEAD, ROW, [], ["", "", "", "", "", "", ""], ROW];
  const r = parseAssessmentFile(xlsxOf(rows));
  ok("빈 줄은 오류로 세지 않음", r.questions.length === 2 && r.skipped === 0, `q=${r.questions.length} skip=${r.skipped}`);

  const many = [HEAD, ...Array.from({ length: MAX_QUESTIONS + 10 }, () => ROW)];
  const rm = parseAssessmentFile(xlsxOf(many));
  ok(`문항 상한 ${MAX_QUESTIONS} 적용`, rm.questions.length === MAX_QUESTIONS, `${rm.questions.length}문항`);
  ok("초과분은 skipped로 보고", rm.skipped === 10, `skipped=${rm.skipped}`);
}

console.log("\n── 헤더 없는 파일 (열 순서만 맞음)");
{
  const r = parseAssessmentFile(xlsxOf([ROW]));
  ok("헤더 없어도 파싱", r.questions.length === 1, `${r.questions.length}문항`);
}

console.log("\n── 빈 파일");
{
  const r = parseAssessmentFile(xlsxOf([HEAD]));
  ok("헤더만 있으면 0문항", r.questions.length === 0 && r.skipped === 0);
}

console.log("\n── 양식 템플릿");
{
  const buf = buildTemplate();
  const r = parseAssessmentFile(new Uint8Array(buf));
  ok("생성한 양식이 그대로 파싱됨", r.questions.length === 1 && r.skipped === 0);
}

console.log("\n── 채점");
{
  const qs = [
    { id: "a", answer: 0 },
    { id: "b", answer: 2 },
    { id: "c", answer: 3 },
  ];
  const g = grade(qs, [
    { questionId: "a", chosen: 0 }, // 정답
    { questionId: "b", chosen: 1 }, // 오답
    // c 미응답
  ]);
  ok("점수 계산", g.score === 1 && g.total === 3, `${g.score}/${g.total}`);
  ok("미응답은 오답 처리", g.rows.find((r) => r.questionId === "c")?.correct === false);
  ok("미응답 chosen = -1", g.rows.find((r) => r.questionId === "c")?.chosen === -1);
  const bad = grade(qs, [{ questionId: "a", chosen: 99 }]);
  ok("범위 밖 선택은 무시(오답)", bad.score === 0);
  const spoof = grade(qs, [{ questionId: "a", chosen: 0 }, { questionId: "zzz", chosen: 0 }]);
  ok("없는 문항 id는 무시", spoof.total === 3 && spoof.score === 1);
}

console.log("\n" + "=".repeat(50));
console.log(`통과 ${pass} · 실패 ${fails.length}`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
