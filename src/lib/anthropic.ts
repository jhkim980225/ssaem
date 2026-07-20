import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export function hasLlmKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

// 답변 생성. ANTHROPIC_API_KEY 우선, 없으면 GEMINI_API_KEY(무료 티어) 폴백.
export async function generate(system: string, messages: ChatMsg[], maxTokens = 1200) {
  if (process.env.ANTHROPIC_API_KEY) {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    });
    return {
      text: msg.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim(),
      model: MODEL,
    };
  }
  // Gemini OpenAI 호환 엔드포인트 — SDK 추가 설치 불필요
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
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return { text: (d.choices?.[0]?.message?.content ?? "").trim(), model: GEMINI_MODEL };
}
