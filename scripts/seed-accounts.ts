// 데모용 간편 계정 생성 (아이디 로그인).
//   강사  test / test
//   학생  st   / st   → 학원의 모든 강사 기본반에 자동 수강 연결
// 실행: npx tsx scripts/seed-accounts.ts
//
// 주의: 사이트가 공개돼 있으면 누구나 이 계정으로 로그인할 수 있다. 데모가 끝나면
//   npx tsx scripts/seed-accounts.ts --remove
// 로 지울 것.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { toEmail, enrollToAcademyTeachers } from "../src/lib/account";

config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const ACCOUNTS = [
  { id: "test", pw: "test", role: "teacher" as const, name: "테스트 강사", subject: "전산회계 2급" },
  { id: "st", pw: "st", role: "student" as const, name: "테스트 학생" },
];

async function findUserId(email: string): Promise<string | null> {
  const { data } = await db.auth.admin.listUsers();
  return data?.users.find((u) => u.email === email)?.id ?? null;
}

async function remove() {
  for (const a of ACCOUNTS) {
    const uid = await findUserId(toEmail(a.id));
    if (!uid) {
      console.log(`${a.id}: 없음`);
      continue;
    }
    await db.auth.admin.deleteUser(uid);
    console.log(`${a.id}: 삭제됨`);
  }
}

async function main() {
  if (process.argv.includes("--remove")) return remove();

  const slug = process.env.DEFAULT_ACADEMY_SLUG || "default";
  const { data: academy } = await db.from("academies").select("id, name").eq("slug", slug).maybeSingle();
  if (!academy) throw new Error(`학원(${slug}) 없음 — scripts/seed.ts 먼저 실행`);

  for (const a of ACCOUNTS) {
    const email = toEmail(a.id);
    let uid = await findUserId(email);
    if (uid) {
      await db.auth.admin.updateUserById(uid, { password: a.pw });
    } else {
      const { data, error } = await db.auth.admin.createUser({
        email,
        password: a.pw,
        email_confirm: true,
      });
      if (error) throw new Error(`${a.id} 생성 실패: ${error.message}`);
      uid = data.user!.id;
    }

    await db.from("profiles").upsert({ id: uid, academy_id: academy.id, role: a.role, name: a.name });
    if (a.role === "teacher") {
      await db.from("teacher_profiles").upsert({ id: uid, subject: a.subject, is_public: true });
    } else {
      const n = await enrollToAcademyTeachers(db, uid, academy.id);
      console.log(`  ${a.name}: 강사 ${n}명에 수강 연결`);
    }
    console.log(`${a.id} / ${a.pw} — ${a.role} (${a.name})`);
  }

  const { data: teachers } = await db
    .from("profiles")
    .select("name")
    .eq("academy_id", academy.id)
    .eq("role", "teacher")
    .order("name");
  console.log(`\n학원: ${academy.name} · 강사: ${(teachers ?? []).map((t) => t.name).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
