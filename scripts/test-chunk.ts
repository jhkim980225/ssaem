// 청킹 독립 테스트. Supabase/키 불필요. 실행: npx tsx scripts/test-chunk.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert";
import { chunkText } from "../src/lib/chunk";

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, "sample-doc.txt"), "utf8");

const SIZE = 400;
const OVERLAP = 80;
const chunks = chunkText(doc, { size: SIZE, overlap: OVERLAP });

console.log(`원문 길이: ${doc.length}자`);
console.log(`청크 수: ${chunks.length}\n`);
chunks.forEach((c, i) => {
  console.log(`── 청크 ${i + 1} (${c.length}자) ─────────────`);
  console.log(c.length > 160 ? c.slice(0, 160) + " …" : c);
  console.log();
});

// 검증
assert(chunks.length > 1, "긴 문서는 2개 이상으로 쪼개져야 함");
const maxLen = SIZE + OVERLAP + 20; // overlap 덧붙임 여유
for (const c of chunks) {
  assert(c.trim().length > 0, "빈 청크 없어야 함");
  assert(c.length <= maxLen, `청크가 너무 큼: ${c.length} > ${maxLen}`);
}
// overlap 확인: 2번째부터는 이전 청크 꼬리 일부를 포함
for (let i = 1; i < chunks.length; i++) {
  const prevTail = chunks[i - 1].slice(-OVERLAP).trim().slice(0, 20);
  assert(
    prevTail.length === 0 || chunks[i].includes(prevTail.slice(0, 10)),
    `청크 ${i + 1} overlap 누락`
  );
}
// 커버리지: 핵심 키워드가 어딘가엔 있어야 함
const joined = chunks.join("\n");
for (const kw of ["복식부기", "대차평균", "분개", "결산", "시산표", "KcLep"]) {
  assert(joined.includes(kw), `키워드 누락: ${kw}`);
}

console.log("✅ 모든 검증 통과");
