import { generateText } from "./anthropic";

export type GenQuestion = {
  question: string;
  choices: string[];
  answer: number; // choices의 0-based 인덱스
  explanation: string;
};

const SYSTEM = `너는 자격증 학원의 출제 조교다. 강사가 올린 자료만 근거로 객관식 문제를 만든다.

규칙:
- 자료에 없는 내용은 절대 만들지 않는다. 자료로 정답을 확정할 수 없으면 그 문제는 만들지 않는다.
- 4지선다. 오답 선택지는 학생이 실제로 헷갈릴 만한 것으로 만든다 (엉뚱한 것 금지).
- 해설은 자료의 근거를 한두 문장으로 짚어준다.
- 존댓말(해요체)로 쓴다.

출력은 JSON 배열만. 설명·코드펜스 없이 배열 자체만 출력한다.
[{"question":"...","choices":["...","...","...","..."],"answer":0,"explanation":"..."}]`;

// 코드펜스나 앞뒤 잡말이 섞여 와도 배열 부분만 뽑아낸다 (모델별 출력 편차 흡수).
function extractJsonArray(raw: string): unknown {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) throw new Error("JSON 배열을 찾지 못했어요");
  return JSON.parse(s.slice(start, end + 1));
}

function isValid(q: unknown): q is GenQuestion {
  if (!q || typeof q !== "object") return false;
  const o = q as Record<string, unknown>;
  return (
    typeof o.question === "string" &&
    o.question.trim().length > 0 &&
    Array.isArray(o.choices) &&
    o.choices.length === 4 &&
    o.choices.every((c) => typeof c === "string" && c.trim().length > 0) &&
    typeof o.answer === "number" &&
    Number.isInteger(o.answer) &&
    o.answer >= 0 &&
    o.answer < 4 &&
    typeof o.explanation === "string"
  );
}

// 자료 원문에서 객관식 문제를 뽑는다. 형식이 깨진 항목은 버리고 성한 것만 반환.
export async function generateQuestions(source: string, count = 5): Promise<GenQuestion[]> {
  const text = source.trim().slice(0, 6000); // 토큰·비용 상한
  if (text.length < 30) return [];

  const raw = await generateText(
    SYSTEM,
    [{ role: "user", content: `다음 자료로 문제를 최대 ${count}개 만들어 주세요.\n\n---\n${text}\n---` }],
    2500
  );

  const parsed = extractJsonArray(raw);
  if (!Array.isArray(parsed)) throw new Error("JSON 배열이 아니에요");
  return parsed.filter(isValid).slice(0, count);
}
