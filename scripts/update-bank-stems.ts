// 파이프라인 재파싱으로 stem 표현이 바뀐 문항을 **id 보존한 채** 갱신한다.
// (import-bank의 (source,stem) upsert는 stem이 바뀌면 새 행을 만들어 버려
//  오답노트 기록(question_id 참조)이 끊긴다 — 그래서 in-place UPDATE가 따로 필요.)
//
//   npx tsx scripts/update-bank-stems.ts            # dry-run (변경 대상만 출력)
//   npx tsx scripts/update-bank-stems.ts --apply    # 실제 반영
//
// 매칭 키: 표 마커·구분자·공백·기호를 다 벗긴 글자만 비교 — 표가 세로 나열이던
// 옛 stem과 [[표]] 직렬화된 새 stem은 글자 내용이 같다. 규칙: docs/문제은행-적재-규칙.md
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: ".env.local" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const SRC = process.env.BANK_SRC || "C:/dev/acct_quiz/pipeline/out/questions.json";
const APPLY = process.argv.includes("--apply");

const norm = (s: string) =>
  (s || "")
    .replace(/\[\[\/?표\]\]/g, "")
    .replace(/[^0-9A-Za-z가-힣]/g, "");

type Row = {
  subject: string; category: string; stem: string; source?: string | null;
  choices?: string[] | null; answer_idx?: number | null; answer_text?: string | null;
  explanation?: string | null; type_tag?: string; area?: string;
};

async function main() {
  const src: Row[] = JSON.parse(readFileSync(SRC, "utf-8"));
  const bySource = new Map<string, Row[]>();
  for (const r of src) {
    const k = r.source ?? "";
    (bySource.get(k) ?? bySource.set(k, []).get(k)!).push(r);
  }

  let updated = 0;
  let unmatched = 0;
  for (const [source, rows] of bySource) {
    if (!source) continue;
    const { data: dbRows } = await db
      .from("bank_questions")
      .select("id, stem, explanation, choices")
      .eq("source", source);
    if (!dbRows?.length) continue;
    const byKey = new Map(dbRows.map((d) => [norm(d.stem), d]));

    for (const r of rows) {
      const hit = byKey.get(norm(r.stem));
      if (!hit) {
        unmatched++;
        continue; // 새 문항 — import-bank가 넣는다
      }
      const stemChanged = hit.stem !== r.stem;
      const expChanged = (hit.explanation ?? "") !== (r.explanation ?? "");
      if (!stemChanged && !expChanged) continue;
      updated++;
      console.log(`${APPLY ? "갱신" : "대상"}: [${source}] ${r.stem.slice(0, 44).replace(/\n/g, " ")}`);
      if (APPLY) {
        const { error } = await db
          .from("bank_questions")
          .update({ stem: r.stem, explanation: r.explanation ?? null, choices: r.choices ?? hit.choices })
          .eq("id", hit.id);
        if (error) console.error(`  실패: ${error.message}`);
      }
    }
  }
  console.log(`\n${APPLY ? "갱신" : "대상"} ${updated}건 · 소스에만 있는(신규) ${unmatched}건${APPLY ? "" : " — 반영은 --apply"}`);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
