import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export function hasLlmKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

export function llmModel() {
  return process.env.ANTHROPIC_API_KEY ? MODEL : GEMINI_MODEL;
}

// 답변 스트리밍. ANTHROPIC_API_KEY 우선, 없으면 GEMINI_API_KEY(무료 티어) 폴백.
// 텍스트 델타를 yield하는 async generator.
export async function* generateStream(
  system: string,
  messages: ChatMsg[],
  maxTokens = 1200
): AsyncGenerator<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta")
        yield event.delta.text;
    }
    return;
  }
  // Gemini OpenAI 호환 SSE — SDK 추가 설치 불필요
  const r = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GEMINI_API_KEY}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      max_tokens: maxTokens,
      reasoning_effort: "none", // thinking 토큰이 max_tokens 먹어서 답변 잘리는 것 방지
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!r.ok || !r.body) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? ""; // 마지막 미완성 라인은 버퍼에 유지
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, "").trim();
      if (!data || data === "[DONE]" || !line.startsWith("data:")) continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* keep-alive 등 무시 */
      }
    }
  }
}
