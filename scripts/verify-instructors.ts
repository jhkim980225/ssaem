// 강사 10명 오프라인 검증 (외부 API 불필요).
// 실행: npx tsx scripts/verify-instructors.ts
import assert from "node:assert";
import { INSTRUCTORS } from "./instructors";
import { chunkText } from "../src/lib/chunk";
import { rank } from "../src/lib/lexical";
import { buildTutorSystem } from "../src/lib/prompt";

type Chunk = { content: string; kind: "problem" | "style" };

let pass = 0;
let fail = 0;

for (const ins of INSTRUCTORS) {
  // 1) 자료 청킹 → 강사별 인메모리 인덱스
  const chunks: Chunk[] = [];
  for (const m of ins.materials) {
    for (const c of chunkText(m.content, { size: 400, overlap: 60 })) {
      chunks.push({ content: c, kind: m.kind });
    }
  }
  assert(chunks.length > 0, `${ins.name}: 청크 없음`);

  console.log(`\n━━ ${ins.name} (${ins.subject}) — 청크 ${chunks.length}개`);

  // 2) 각 검증 질문: 맞는 청크가 top-1로 검색되는지
  for (const t of ins.tests) {
    const hits = rank(t.q, chunks, 3);
    const top = hits[0]?.content ?? "";
    const ok = top.includes(t.expectIncludes);
    if (ok) pass++;
    else fail++;
    console.log(`   [${ok ? "✓" : "✗"}] "${t.q}" → top: ${top.slice(0, 28)}…`);
    assert(ok, `${ins.name}: "${t.q}" 검색 실패 — 기대="${t.expectIncludes}" 실제="${top.slice(0, 40)}"`);

    // 3) 프롬프트 조립: 검색 청크 + 강사명 포함 확인
    const sys = buildTutorSystem({ name: ins.name, subject: ins.subject }, hits);
    assert(sys.includes(top.slice(0, 20)), `${ins.name}: 프롬프트에 검색 청크 누락`);
    assert(sys.includes(ins.name), `${ins.name}: 프롬프트에 이름 누락`);
  }
}

console.log(`\n═══════════════════════════`);
console.log(`강사 ${INSTRUCTORS.length}명 | 검색 테스트 ${pass}/${pass + fail} 통과`);
console.log(`✅ 전체 검증 통과 (청킹·강사별검색·프롬프트조립)`);
