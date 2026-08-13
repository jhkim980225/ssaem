// 문제은행 적재. 소스 파이프라인 산출물(questions.json)을 bank_questions로 upsert.
// 실행: npx tsx scripts/import-bank.ts
//   BANK_SRC=<경로> 로 소스 json 경로 지정 (기본: C:\dev\acct_quiz\pipeline\out\questions.json)
// 선행: migrations/20260813000000_question_bank.sql 를 Supabase SQL Editor에서 실행해 둘 것.
// 재실행 안전 — stem 충돌 시 upsert.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync } from "node:fs";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const SRC = process.env.BANK_SRC || "C:\\dev\\acct_quiz\\pipeline\\out\\questions.json";
const BATCH = 500;

type Row = {
  subject: string;
  category: string;
  type_tag?: string;
  area?: string;
  stem: string;
  choices?: string[] | null;
  answer_idx?: number | null;
  answer_text?: string | null;
  explanation?: string | null;
  source?: string | null;
};

function valid(r: Row): boolean {
  if (!r.subject || !r.category || !r.stem?.trim()) return false;
  // 스키마 CHECK와 동일: 이론=choices+answer_idx, 실무=answer_text
  const theory = Array.isArray(r.choices) && r.choices.length >= 2 && typeof r.answer_idx === "number";
  const practice = typeof r.answer_text === "string" && r.answer_text.trim().length > 0;
  return theory || practice;
}

async function main() {
  let raw: Row[];
  try {
    raw = JSON.parse(readFileSync(SRC, "utf-8"));
  } catch (e) {
    console.error(`❌ 소스 읽기 실패: ${SRC}\n   ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  if (!Array.isArray(raw)) {
    console.error("❌ 소스가 배열이 아닙니다");
    process.exit(1);
  }
  console.log(`소스 ${raw.length}건`);

  // stem 중복 제거 (소스는 unique 제약. 배치 안 충돌도 방지) + 유효성
  const seen = new Set<string>();
  const rows: Row[] = [];
  let dup = 0;
  let invalid = 0;
  for (const r of raw) {
    if (!valid(r)) {
      invalid++;
      continue;
    }
    const stem = r.stem.trim();
    if (seen.has(stem)) {
      dup++;
      continue;
    }
    seen.add(stem);
    rows.push({
      subject: r.subject,
      category: r.category,
      type_tag: r.type_tag || "미분류",
      area: r.area || "재무회계",
      stem,
      choices: r.category === "이론" ? r.choices ?? null : null,
      answer_idx: r.category === "이론" ? r.answer_idx ?? null : null,
      answer_text: r.answer_text ?? null,
      explanation: r.explanation ?? null,
      source: r.source ?? null,
    });
  }
  console.log(`중복 ${dup} · 부적합 ${invalid} 제외 → 적재 대상 ${rows.length}건`);

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await db
      .from("bank_questions")
      .upsert(chunk, { onConflict: "stem", ignoreDuplicates: false });
    if (error) {
      console.error(`❌ 배치 ${i}~${i + chunk.length}: ${error.message}`);
      process.exit(1);
    }
    process.stdout.write(`\r  적재 ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
  console.log("");

  // 확인
  const { count: total } = await db.from("bank_questions").select("id", { count: "exact", head: true });
  const { data: byCat } = await db.from("bank_tag_counts").select("category, count");
  const cat: Record<string, number> = {};
  for (const r of (byCat ?? []) as { category: string; count: number }[])
    cat[r.category] = (cat[r.category] ?? 0) + r.count;
  console.log(`✅ bank_questions 총 ${total}건`);
  console.log(`   카테고리: ${JSON.stringify(cat)}`);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
