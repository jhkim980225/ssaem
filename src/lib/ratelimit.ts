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

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
