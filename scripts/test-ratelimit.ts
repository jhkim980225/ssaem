// rate limit 셀프체크: npx tsx scripts/test-ratelimit.ts
import assert from "node:assert";
import { rateLimit } from "../src/lib/ratelimit";

// 한도 안 → 허용
for (let i = 0; i < 5; i++) assert.ok(rateLimit("a", 5, 1000), `허용되어야 함 (${i + 1}회)`);
// 한도 초과 → 차단
assert.ok(!rateLimit("a", 5, 1000), "6회째는 차단");
// 다른 키는 독립
assert.ok(rateLimit("b", 5, 1000), "다른 키는 허용");
// 윈도 지나면 리셋 (tsx cjs 출력이 top-level await 미지원 → main 함수)
async function main() {
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok(rateLimit("a", 5, 1000), "윈도 경과 후 허용");
  console.log("✅ ratelimit 검증 통과");
}
main();
