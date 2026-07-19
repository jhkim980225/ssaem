// 키워드 렉시컬 스코어링. 임베딩 없을 때 폴백 랭킹용 (한국어 char 2-gram + 토큰 겹침).
// 프로덕션 폴백과 오프라인 검증 하네스가 공유.

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function bigrams(s: string): Set<string> {
  const n = normalize(s).replace(/\s+/g, "");
  const g = new Set<string>();
  for (let i = 0; i < n.length - 1; i++) g.add(n.slice(i, i + 2));
  return g;
}

function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter((t) => t.length >= 2);
}

export function score(query: string, text: string): number {
  const qb = bigrams(query);
  const tb = bigrams(text);
  let inter = 0;
  for (const g of qb) if (tb.has(g)) inter++;
  // 토큰 완전일치 가중
  const tt = new Set(tokens(text));
  let tok = 0;
  for (const t of tokens(query)) if (tt.has(t)) tok++;
  return inter + tok * 3;
}

export function rank<T extends { content: string }>(query: string, items: T[], k = 5): T[] {
  return [...items]
    .map((it) => ({ it, s: score(query, it.content) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.it);
}
