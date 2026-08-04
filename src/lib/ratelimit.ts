// 인메모리 슬라이딩 윈도우 rate limit.
// ponytail: 단일 인스턴스 메모리 기반 — 다중 인스턴스/서버리스 스케일아웃 시 Upstash 등으로 교체.

const buckets = new Map<string, number[]>();

// key당 windowMs 안에 limit회 초과 시 false.
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  // 메모리 방어: 오래된 키 주기적 정리
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k);
    }
  }
  return true;
}

// 클라이언트 IP. x-forwarded-for의 "첫" 항목은 클라가 위조 가능(헤더에 직접 넣으면 앞에 붙음).
// Vercel은 신뢰 가능한 x-vercel-forwarded-for / x-real-ip를 프록시에서 덮어써 준다 — 그걸 우선.
// 폴백으로 XFF를 쓸 땐 프록시가 마지막에 append하므로 "마지막" 항목을 쓴다.
export function clientIp(req: Request): string {
  const trusted = req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-real-ip");
  if (trusted) return trusted.split(",").pop()!.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}
