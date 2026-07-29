import { anthropic, MODEL, GEMINI_MODEL } from "./anthropic";

// 스캔 PDF OCR — LLM 비전으로 텍스트 추출. unpdf 추출 실패 시 폴백 전용.
// GEMINI_API_KEY(무료) 우선, 없으면 ANTHROPIC_API_KEY. 둘 다 없으면 null.
// ponytail: 페이지 분할 없이 PDF 통째 1콜 — 아주 긴 스캔본은 max_tokens에 잘림. 필요해지면 페이지 배치로.

const MAX_BYTES = 15 * 1024 * 1024; // 인라인 base64 한도 방어
const PROMPT =
  "이 PDF의 모든 텍스트를 순서대로 추출해줘. 문제 번호·수식·표 구조 유지. 설명 없이 추출 텍스트만 출력.";

export async function ocrPdf(buf: Uint8Array): Promise<string | null> {
  if (buf.byteLength > MAX_BYTES) throw new Error("PDF가 너무 커요 (15MB 이하)");
  const b64 = Buffer.from(buf).toString("base64");

  if (process.env.GEMINI_API_KEY) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: "application/pdf", data: b64 } },
                { text: PROMPT },
              ],
            },
          ],
        }),
      }
    );
    if (!res.ok) throw new Error(`ocr failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    type Part = { text?: string };
    const parts: Part[] = (await res.json()).candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? "").join("").trim();
    return text || null;
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: b64 },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
    const text = msg.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return text || null;
  }

  return null;
}
