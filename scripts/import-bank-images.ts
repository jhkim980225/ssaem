// 기출 문제 그림 자료 적재 — acct_quiz 파이프라인의 extract_images.py 산출물을
// Supabase Storage(bank-images, public)에 올리고 bank_questions.images에 URL을 연결한다.
//
//   npx tsx scripts/import-bank-images.ts "전산회계2급 111회"
//   npx tsx scripts/import-bank-images.ts            # out/images/*.json 전부
//
// 매칭: 캡처의 q_text(문제 블록 첫 문장, "7. " 번호 제거)를 공백 제거 후
// 같은 source의 stem 앞부분과 대조. 규칙: docs/문제은행-적재-규칙.md
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env.local" });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const IMG_DIR = process.env.BANK_IMG_DIR || "C:/dev/acct_quiz/pipeline/out/images";
const BUCKET = "bank-images";

const norm = (s: string) => s.replace(/\s+/g, "");

// Storage 키는 ASCII만 안전 — 과목 한글을 슬러그로 (예: "전산회계2급 111회" → "ca2-111")
const SUBJECT_SLUG: Record<string, string> = { 전산회계1급: "ca1", 전산회계2급: "ca2", 전산세무2급: "ct2" };
function slugSource(source: string): string {
  const m = source.match(/^(\S+)\s*(\d+)회$/);
  const subj = m ? SUBJECT_SLUG[m[1]] : undefined;
  return subj && m ? `${subj}-${m[2]}` : source.replace(/[^\w-]/g, "-");
}

async function ensureBucket() {
  const { data } = await db.storage.getBucket(BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`버킷 생성 실패: ${error.message}`);
    console.log(`버킷 ${BUCKET} 생성 (public)`);
  }
}

async function importSource(source: string) {
  type Cap = { file: string; page: number; q_text: string };
  let caps: Cap[];
  try {
    caps = JSON.parse(readFileSync(join(IMG_DIR, `${source}.json`), "utf-8"));
  } catch {
    console.log(`${source}: 캡처 json 없음 — 건너뜀`);
    return;
  }
  if (!caps.length) {
    console.log(`${source}: 캡처 0개`);
    return;
  }

  const { data: rows } = await db.from("bank_questions").select("id, stem, images").eq("source", source);
  let linked = 0;
  for (const c of caps) {
    // "7. 다음은 …" → 번호 떼고 앞 25자(공백 제거)로 stem 매칭
    const head = norm(c.q_text.replace(/^(\d{1,2}\.|\[\d{1,2}\])\s*/, "")).slice(0, 25);
    const row = (rows ?? []).find((r) => norm(r.stem).startsWith(head));
    if (!row) {
      console.warn(`  매칭 실패: ${c.file} ← "${c.q_text.slice(0, 50)}"`);
      continue;
    }
    const path = `${slugSource(source)}/${c.file}`;
    const bytes = readFileSync(join(IMG_DIR, source, c.file));
    const { error: uerr } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (uerr) {
      console.error(`  업로드 실패 ${path}: ${uerr.message}`);
      continue;
    }
    const url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const images = [...new Set([...(Array.isArray(row.images) ? row.images : []), url])];
    const { error: perr } = await db.from("bank_questions").update({ images }).eq("id", row.id);
    if (perr) {
      console.error(`  연결 실패 ${row.id}: ${perr.message}`);
      continue;
    }
    linked++;
    console.log(`  ${c.file} → "${row.stem.slice(0, 40).replace(/\n/g, " ")}"`);
  }
  console.log(`${source}: ${linked}/${caps.length} 연결`);
}

async function main() {
  await ensureBucket();
  const arg = process.argv[2];
  const sources = arg
    ? [arg]
    : readdirSync(IMG_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  for (const s of sources) await importSource(s);
}

main().catch((e) => {
  console.error("FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
