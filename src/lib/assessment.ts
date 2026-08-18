import * as XLSX from "xlsx";

// 평가 문항 파싱·채점. 순수 함수라 DB·네트워크 없이 테스트한다.
//
// 업로드 양식 (헤더 1행 필수):
//   문제 | 보기1 | 보기2 | 보기3 | 보기4 | 정답 | 해설
// 정답은 사람이 쓰기 쉬운 1~4로 받아 0-based로 저장한다 (기존 quiz의 answer와 같은 규약).

export const MAX_QUESTIONS = 200;
export const MAX_TEXT = 500; // 문제·보기·해설 각 상한 (초과분 절단)

export type ParsedQuestion = {
  question: string;
  choices: [string, string, string, string];
  answer: number; // 0-based
  explanation: string | null;
};

export type ParseResult = {
  questions: ParsedQuestion[];
  skipped: number; // 형식이 깨져 버린 행 수
};

/** 헤더 이름 후보 — 한글 양식이 기본, 영문도 받아준다. */
const COL = {
  question: ["문제", "질문", "question", "q"],
  choices: [
    ["보기1", "선택지1", "choice1", "1"],
    ["보기2", "선택지2", "choice2", "2"],
    ["보기3", "선택지3", "choice3", "3"],
    ["보기4", "선택지4", "choice4", "4"],
  ],
  answer: ["정답", "답", "answer"],
  explanation: ["해설", "설명", "explanation"],
};

function norm(s: unknown): string {
  return (s ?? "").toString().trim();
}

/** 헤더 행에서 컬럼 위치를 찾는다. 공백·대소문자 무시. */
function findCol(header: string[], names: string[]): number {
  const flat = header.map((h) => norm(h).toLowerCase().replace(/\s+/g, ""));
  for (const n of names) {
    const i = flat.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * 워크북 읽기. 인코딩 때문에 xlsx와 CSV를 다르게 다룬다.
 *
 * - xlsx: zip(PK) 컨테이너라 내부가 UTF-8 XML — 바이트 그대로 넘기면 된다.
 * - CSV : SheetJS의 기본 코드페이지가 UTF-8이 아니라, 바이트로 넘기면 한글이 깨진다.
 *         그래서 **우리가 직접 디코딩해 문자열로** 넘긴다.
 *         UTF-8로 읽히면 UTF-8, 아니면 cp949(한국 엑셀 "CSV로 저장"의 기본).
 */
function readWorkbook(u8: Uint8Array) {
  if (u8[0] === 0x50 && u8[1] === 0x4b) return XLSX.read(u8, { type: "array" }); // PK.. = xlsx

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(u8);
  } catch {
    text = new TextDecoder("euc-kr").decode(u8); // cp949 상위호환
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM 제거
  return XLSX.read(text, { type: "string" });
}

function cut(s: string): string {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
}

/**
 * 엑셀(.xlsx)·CSV 버퍼를 문항 배열로.
 * SheetJS가 인코딩(cp949 포함)·시트 구조를 처리한다.
 * 형식이 깨진 행은 버리고 skipped로 센다 — 한 줄 때문에 업로드 전체가 실패하지 않게.
 */
export function parseAssessmentFile(buf: ArrayBuffer | Uint8Array): ParseResult {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const wb = readWorkbook(u8);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { questions: [], skipped: 0 };

  // header:1 → 2차원 배열. 헤더 이름을 우리가 직접 매칭한다.
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  if (!rows.length) return { questions: [], skipped: 0 };

  const header = (rows[0] as unknown[]).map(norm);
  const qi = findCol(header, COL.question);
  const ci = COL.choices.map((names) => findCol(header, names));
  const ai = findCol(header, COL.answer);
  const ei = findCol(header, COL.explanation);

  // 헤더를 못 찾으면 위치 기본값(0~6)으로 — 양식 그대로 쓴 파일은 헤더가 있고,
  // 헤더를 지운 파일도 열 순서만 맞으면 통과시킨다.
  const qCol = qi >= 0 ? qi : 0;
  const cCols = ci.map((v, k) => (v >= 0 ? v : k + 1));
  const aCol = ai >= 0 ? ai : 5;
  const eCol = ei >= 0 ? ei : 6;
  // 헤더 이름을 못 찾았어도, 첫 행의 정답 칸이 1~4가 아니면 그 행은 헤더로 본다.
  // (안 그러면 헤더 행이 "깨진 문항"으로 잘못 집계된다)
  const firstAnswer = norm((rows[0] as unknown[])?.[aCol]);
  const hasHeader = qi >= 0 || ai >= 0 || !/[1-4]/.test(firstAnswer);

  const out: ParsedQuestion[] = [];
  let skipped = 0;

  for (let r = hasHeader ? 1 : 0; r < rows.length; r++) {
    if (out.length >= MAX_QUESTIONS) {
      skipped += rows.length - r;
      break;
    }
    const row = rows[r] as unknown[];
    if (!row || row.every((c) => norm(c) === "")) continue; // 빈 줄은 스킵(오류 아님)

    const question = norm(row[qCol]);
    const choices = cCols.map((c) => norm(row[c]));
    const answerRaw = norm(row[aCol]);
    const explanation = norm(row[eCol]);

    // 정답은 1~4. "3번", "③" 같은 표기도 숫자만 뽑아 받아준다.
    const answerNum = Number((answerRaw.match(/[1-4]/) ?? [])[0]);

    const bad =
      !question ||
      choices.some((c) => !c) ||
      !Number.isInteger(answerNum) ||
      answerNum < 1 ||
      answerNum > 4;
    if (bad) {
      skipped++;
      continue;
    }

    out.push({
      question: cut(question),
      choices: choices.map(cut) as [string, string, string, string],
      answer: answerNum - 1, // 1-based → 0-based
      explanation: explanation ? cut(explanation) : null,
    });
  }

  return { questions: out, skipped };
}

/** 업로드 양식 파일(빈 템플릿) 생성 — 강사가 받아서 채워 올린다. */
export function buildTemplate(): ArrayBuffer {
  const rows = [
    ["문제", "보기1", "보기2", "보기3", "보기4", "정답", "해설"],
    ["감가상각 정액법 계산식은?", "(취득원가-잔존가치)÷내용연수", "취득원가÷내용연수", "장부가액×상각률", "취득원가×상각률", "1", "정액법은 매기 같은 금액을 상각한다."],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "평가문항");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export type SubmitAnswer = { questionId: string; chosen: number };
export type GradeRow = { questionId: string; chosen: number; correct: boolean };
export type GradeResult = { score: number; total: number; rows: GradeRow[] };

/**
 * 채점. 정답은 서버 DB 값만 쓴다 (클라이언트가 보낸 정답은 신뢰하지 않는다).
 * 미응답·범위 밖 선택은 오답 처리 — 빈칸으로 제출해도 응시로 인정한다.
 */
export function grade(
  questions: { id: string; answer: number }[],
  answers: SubmitAnswer[]
): GradeResult {
  const picked = new Map<string, number>();
  for (const a of answers) {
    const n = Number(a?.chosen);
    if (Number.isInteger(n) && n >= 0 && n <= 3) picked.set((a?.questionId ?? "").toString(), n);
  }
  const rows: GradeRow[] = questions.map((q) => {
    const chosen = picked.has(q.id) ? picked.get(q.id)! : -1;
    return { questionId: q.id, chosen, correct: chosen === q.answer };
  });
  return { score: rows.filter((r) => r.correct).length, total: questions.length, rows };
}
