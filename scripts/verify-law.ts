// 공용 참고자료(현행 법령) 검증 — 적재 상태 · 조문 검색 적중 · 프롬프트 조립.
// 실행: npx tsx scripts/verify-law.ts   (Supabase + 임베딩 키 필요)
//
// 선행: npx tsx scripts/import-law.ts
import assert from "node:assert";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

import { embed } from "../src/lib/embed";
import { buildTutorSystem } from "../src/lib/prompt";
// retrieve는 정적 import 금지 — src/lib/supabase.ts가 **모듈 로드 시점에** URL을 읽는데
// ESM은 import를 config()보다 먼저 실행해서 placeholder URL이 박힌다. main 안에서 동적 import.

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// 질문 → 근거로 나와야 하는 조문(법령명 + 조문번호). 시험에 실제로 나오는 것들.
const CASES: { q: string; expect: RegExp }[] = [
  { q: "종합소득 과세표준에 적용하는 소득세 세율이 어떻게 되나요?", expect: /소득세법 제55조/ },
  { q: "근로소득공제는 총급여액 구간별로 얼마씩 공제되나요?", expect: /소득세법 제47조/ },
  { q: "기본공제 대상자 1명당 연 얼마를 공제하나요?", expect: /소득세법 제50조/ },
  { q: "종합소득세 확정신고 기한은 언제까지인가요?", expect: /소득세법 제70조/ },
];

let pass = 0;
let fail = 0;

async function main() {
  // 1) 적재 상태
  const { data: docs } = await db
    .from("documents")
    .select("id, title, kind")
    .is("teacher_id", null)
    .eq("kind", "law");
  assert(docs?.length, "공용 법령 문서가 없습니다 — scripts/import-law.ts 먼저 실행");
  console.log(`공용 법령 문서 ${docs.length}건`);
  for (const d of docs) {
    const { count } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", d.id);
    const { count: noVec } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", d.id)
      .is("embedding", null);
    console.log(`  ${d.title} — 청크 ${count} (임베딩 없음 ${noVec})`);
    assert((count ?? 0) > 0, `${d.title}: 청크 0개`);
    assert((noVec ?? 0) === 0, `${d.title}: 임베딩 없는 청크 ${noVec}개 — 재실행 필요`);
  }

  // 2) 조문 검색 적중 — 질문을 넣으면 해당 조문이 근거로 나오는가
  console.log("\n━━ 조문 검색");
  for (const c of CASES) {
    const vec = await embed(c.q);
    assert(vec, "임베딩 실패 — 키/쿼터 확인");
    const { data, error } = await db.rpc("match_reference_chunks", { p_query: vec, p_k: 3 });
    assert(!error, `match_reference_chunks 실패: ${error?.message}`);
    const hits = (data ?? []) as { content: string; kind: string; similarity: number }[];
    const hit = hits.find((h) => c.expect.test(h.content));
    if (hit) pass++;
    else fail++;
    console.log(
      `   [${hit ? "✓" : "✗"}] "${c.q.slice(0, 28)}…" → ${hits[0]?.content.split("\n")[0].slice(0, 42) ?? "(없음)"}`
    );
    assert(hits.every((h) => h.kind === "law"), "공용 검색에 법령 아닌 청크가 섞였습니다");
  }

  // 3) retrieve — 강사 자료는 그대로, 법령이 뒤에 붙는가
  console.log("\n━━ retrieve 합류");
  const { data: teacher } = await db
    .from("profiles")
    .select("id, name")
    .eq("role", "teacher")
    .limit(1)
    .maybeSingle();
  if (!teacher) {
    console.log("   강사 계정이 없어 건너뜀 (scripts/seed.ts)");
  } else {
    const { retrieve } = await import("../src/lib/retrieve");
    const hits = await retrieve(teacher.id, CASES[0].q, 5);
    const laws = hits.filter((h) => h.kind === "law");
    console.log(`   ${teacher.name}: 총 ${hits.length}건 (강사 ${hits.length - laws.length} · 법령 ${laws.length})`);
    assert(laws.length > 0, "법령 청크가 합류하지 않았습니다");
    // 법령은 항상 뒤에 붙는다 — 강사 자료를 밀어내면 안 된다
    assert(
      hits.slice(0, hits.length - laws.length).every((h) => h.kind !== "law"),
      "법령이 강사 자료 사이에 끼어들었습니다"
    );

    // 4) 프롬프트: 법령 섹션이 강사 자료와 분리돼 들어가는가
    const sys = buildTutorSystem({ name: teacher.name, subject: "전산세무 1급" }, hits);
    assert(sys.includes("현행 법령 조문"), "프롬프트에 법령 섹션 없음");
    assert(sys.includes("출제 당시 기준"), "기출/현행 구분 지시가 빠졌습니다");
    assert(
      sys.indexOf("선생님이 등록한 참고 자료") < sys.indexOf("현행 법령 조문") ||
        !sys.includes("선생님이 등록한 참고 자료"),
      "법령 섹션이 강사 자료보다 앞에 왔습니다"
    );
    console.log("   프롬프트 조립 OK (법령 섹션 분리 + 시행일 구분 지시)");
  }

  console.log(`\n═══════════════════════════`);
  console.log(`조문 검색 ${pass}/${pass + fail} 통과`);
  assert(fail === 0, `${fail}건 실패`);
  console.log("✅ 법령 참고자료 검증 통과");
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
