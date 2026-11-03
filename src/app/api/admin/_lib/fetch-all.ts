// PostgREST 1000행 캡(max_rows)은 service role에도 걸린다 — .limit(20000)을 줘도 1000행에서
// 조용히 잘려 큰 학원 통계가 틀렸다. .range()로 끝까지 읽는다 (bank/route.ts와 같은 우회).
// 페이지 경계에서 중복·누락이 없으려면 호출자가 유일한 2차 정렬키(id 등)까지 걸어야 한다.
const PAGE = 1000;
const MAX_PAGES = 50; // 폭주 방어 — 5만 행이면 JS 집계를 SQL RPC로 옮길 때다

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: out, error };
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return { data: out, error: null };
}
