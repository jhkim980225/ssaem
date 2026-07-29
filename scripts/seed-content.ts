// 김대차 강사에 급수별 강좌 + 자료 시드. 멱등: 자료 있는 강좌는 스킵.
// npx tsx scripts/seed-content.ts  (실 Supabase + 임베딩 키 필요)
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { CONTENT } from "./content-accounting";
import { chunkText } from "../src/lib/chunk";
import { embedMany } from "../src/lib/embed";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function main() {
  // 김대차(t01@a.test) 강사 찾기
  const { data: teacher, error: terr } = await db
    .from("profiles")
    .select("id, academy_id, name")
    .eq("name", "김대차")
    .eq("role", "teacher")
    .maybeSingle();
  if (terr || !teacher) throw new Error("김대차 강사 없음 — 먼저 scripts/seed.ts 실행");
  console.log(`강사: ${teacher.name} (${teacher.id})`);

  for (const pack of CONTENT) {
    // 강좌 확보 (있으면 재사용)
    let { data: course } = await db
      .from("courses")
      .select("id")
      .eq("teacher_id", teacher.id)
      .eq("title", pack.course)
      .maybeSingle();
    if (!course) {
      const { data: made, error } = await db
        .from("courses")
        .insert({ academy_id: teacher.academy_id, teacher_id: teacher.id, title: pack.course })
        .select("id")
        .single();
      if (error) throw error;
      course = made;
    }

    const { count } = await db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("course_id", course.id);
    if ((count ?? 0) > 0) {
      console.log(`- ${pack.course}: 자료 ${count}개 이미 있음 → 스킵`);
      continue;
    }

    let chunks = 0;
    for (const m of pack.materials) {
      const { data: doc, error: derr } = await db
        .from("documents")
        .insert({
          teacher_id: teacher.id,
          course_id: course.id,
          kind: m.kind,
          title: m.content.slice(0, 40),
          source: "text",
          raw_text: m.content,
        })
        .select("id")
        .single();
      if (derr) throw derr;
      const pieces = chunkText(m.content);
      const vecs = await embedMany(pieces);
      const rows = pieces.map((content, i) => ({
        document_id: doc.id,
        teacher_id: teacher.id,
        ord: i,
        content,
        embedding: vecs[i],
      }));
      const { error: cerr } = await db.from("chunks").insert(rows);
      if (cerr) throw cerr;
      chunks += rows.length;
    }
    console.log(`- ${pack.course}: 자료 ${pack.materials.length}개, 청크 ${chunks}개 시드됨`);
  }
  console.log("✅ 완료");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
