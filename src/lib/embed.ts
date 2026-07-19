// 임베딩 격리 모듈. OpenAI 키 있으면 벡터, 없으면 null(→키워드 검색 폴백).
// ponytail: 프로바이더 바꾸려면 이 파일만 수정.

const DIM = 1536;

export async function embed(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = process.env.EMBED_MODEL || "text-embedding-3-small";
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`embed failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const v = json.data?.[0]?.embedding;
  if (!Array.isArray(v) || v.length !== DIM) throw new Error("bad embedding dim");
  return v;
}
