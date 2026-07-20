// 강사 10명 시드 (schema v2). 실행 전 .env.local 채우기.
// 실행: npx tsx scripts/seed.ts
// 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (OPENAI_API_KEY는 선택)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { INSTRUCTORS } from "./instructors";
import { chunkText } from "../src/lib/chunk";
import { embed } from "../src/lib/embed";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const DEFAULT_PW = process.env.SEED_PASSWORD || "123456"; // supabase 최소 6자
const SLUG = process.env.DEFAULT_ACADEMY_SLUG || "default";
const ACADEMY_NAME = process.env.DEFAULT_ACADEMY_NAME || "우리학원";

async function ensureAcademy(): Promise<string> {
  const { data } = await db.from("academies").select("id").eq("slug", SLUG).maybeSingle();
  if (data) return data.id;
  const { data: made, error } = await db
    .from("academies")
    .insert({ slug: SLUG, name: ACADEMY_NAME })
    .select("id")
    .single();
  if (error) throw error;
  return made.id;
}

async function ensureUser(email: string): Promise<string | null> {
  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: DEFAULT_PW,
    email_confirm: true,
  });
  if (!error && created?.user) return created.user.id;
  // 이미 존재 → 조회 + 비번을 현재 DEFAULT_PW로 갱신 (idempotent)
  const { data: list } = await db.auth.admin.listUsers();
  const u = list?.users.find((x) => x.email === email);
  if (u) await db.auth.admin.updateUserById(u.id, { password: DEFAULT_PW });
  return u?.id ?? null;
}

// 구 도메인(@academy.test) 시드 계정 정리 — 목록 중복 방지
async function cleanupOldSeedUsers() {
  const { data: list } = await db.auth.admin.listUsers();
  for (const u of list?.users ?? []) {
    if (u.email?.endsWith("@academy.test")) {
      await db.auth.admin.deleteUser(u.id); // profiles 등은 FK cascade
      console.log(`🧹 구 계정 삭제: ${u.email}`);
    }
  }
}

async function main() {
  const academyId = await ensureAcademy();
  console.log(`학원: ${ACADEMY_NAME} (${SLUG})\n`);
  await cleanupOldSeedUsers();

  for (const ins of INSTRUCTORS) {
    const email = `${ins.id}@a.test`;
    const uid = await ensureUser(email);
    if (!uid) {
      console.error(`❌ ${ins.name}: 계정 생성/조회 실패`);
      continue;
    }

    await db.from("profiles").upsert({ id: uid, academy_id: academyId, role: "teacher", name: ins.name });
    await db.from("teacher_profiles").upsert({ id: uid, subject: ins.subject, tone_note: ins.tone, is_public: true });

    // 기존 문서 제거 후 재삽입 (idempotent). chunks는 cascade.
    await db.from("documents").delete().eq("teacher_id", uid);

    let total = 0;
    for (const m of ins.materials) {
      const { data: doc, error } = await db
        .from("documents")
        .insert({
          teacher_id: uid,
          kind: m.kind,
          title: m.content.slice(0, 40),
          source: "text",
          raw_text: m.content,
        })
        .select("id")
        .single();
      if (error) throw error;

      const pieces = chunkText(m.content);
      const rows = [];
      for (let i = 0; i < pieces.length; i++) {
        rows.push({
          document_id: doc.id,
          teacher_id: uid,
          ord: i,
          content: pieces[i],
          embedding: await embed(pieces[i]),
        });
      }
      const { error: cerr } = await db.from("chunks").insert(rows);
      if (cerr) throw cerr;
      total += rows.length;
    }

    console.log(`✅ ${ins.name} (${email}) — 문서 ${ins.materials.length}개 / 청크 ${total}개`);
  }
  console.log(`\n완료. 로그인: <id>@a.test / ${DEFAULT_PW}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
