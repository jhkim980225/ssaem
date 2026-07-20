// 임베딩 격리 모듈. OPENAI_API_KEY > GEMINI_API_KEY(무료) 순. 둘 다 없으면 null(→키워드 폴백).
// ponytail: 프로바이더 바꾸려면 이 파일만 수정.

const DIM = 1536; // chunks.embedding vector(1536) 고정

export async function embed(text: string): Promise<number[] | null> {
  const input = text.slice(0, 8000);

  if (process.env.OPENAI_API_KEY) {
    const model = process.env.EMBED_MODEL || "text-embedding-3-small";
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
    const v = (await res.json()).data?.[0]?.embedding;
    if (!Array.isArray(v) || v.length !== DIM) throw new Error("bad embedding dim");
    return v;
  }

  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          content: { parts: [{ text: input }] },
          outputDimensionality: DIM, // 3072 기본을 1536으로 축소 (MRL)
        }),
      }
    );
    if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
    const v = (await res.json()).embedding?.values;
    if (!Array.isArray(v) || v.length !== DIM) throw new Error("bad embedding dim");
    // 1536 축소본은 비정규화 상태 → 정규화 (cosine엔 영향 없지만 안전빵)
    const norm = Math.hypot(...v) || 1;
    return v.map((x: number) => x / norm);
  }

  return null;
}
