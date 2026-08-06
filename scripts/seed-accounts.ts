// 데모용 간편 계정 (아이디 로그인).
//   강사  test / test  → 학원에서 자료가 가장 많은 강사 계정에 자격을 붙인다.
//                        (새 빈 강사를 만들면 대시보드가 비어 데모가 안 되므로)
//   학생  st   / st    → 학원의 모든 강사 기본반에 자동 수강 연결
//
// 실행:  npx tsx scripts/seed-accounts.ts
// 삭제:  npx tsx scripts/seed-accounts.ts --remove   (st만 삭제. 강사는 원래 계정이라 자격만 되돌림)
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { toEmail, enrollToAcademyTeachers } from "../src/lib/account";

config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const TEACHER = { id: "test", pw: "test" };
const STUDENT = { id: "st", pw: "st", name: "테스트 학생" };

async function users() {
  const { data } = await db.auth.admin.listUsers();
  return data?.users ?? [];
}

// 자료가 가장 많은 강사 = 데모에서 보여줄 강사
async function contentOwner() {
  const { data: ts } = await db.from("profiles").select("id, name, academy_id").eq("role", "teacher");
  const scored = [];
  for (const t of ts ?? []) {
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("teacher_id", t.id);
    scored.push({ ...t, docs: count ?? 0 });
  }
  scored.sort((a, b) => b.docs - a.docs);
  return scored[0] ?? null;
}

// 강사 데이터를 새 uid로 이관. teacher_id를 들고 있는 테이블만 옮기면 나머지(chunks→documents,
// messages→conversations, enrollments→courses)는 그대로 따라온다.
// 이관을 다 확인한 뒤에만 옛 계정을 지운다 — 먼저 지우면 cascade로 자료가 날아간다.
const TEACHER_TABLES = ["documents", "chunks", "courses", "conversations", "document_events"] as const;

async function countsFor(uid: string) {
  const out: Record<string, number> = {};
  for (const t of TEACHER_TABLES) {
    const { count } = await db.from(t).select("id", { count: "exact", head: true }).eq("teacher_id", uid);
    out[t] = count ?? 0;
  }
  return out;
}

async function migrateTeacher(oldId: string, name: string, academyId: string, email: string) {
  const before = await countsFor(oldId);
  console.log(`  이관 전: ${Object.entries(before).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  const { data: created, error: cerr } = await db.auth.admin.createUser({
    email,
    password: TEACHER.pw,
    email_confirm: true,
  });
  if (cerr) throw new Error(`새 계정 생성 실패: ${cerr.message}`);
  const newId = created.user!.id;

  // 프로필 먼저 — FK 대상이 있어야 teacher_id를 옮길 수 있다
  const { data: tp } = await db.from("teacher_profiles").select("subject, tone_note, is_public").eq("id", oldId).maybeSingle();
  await db.from("profiles").upsert({ id: newId, academy_id: academyId, role: "teacher", name });
  await db.from("teacher_profiles").upsert({
    id: newId,
    subject: tp?.subject ?? null,
    tone_note: tp?.tone_note ?? null,
    is_public: tp?.is_public ?? true,
  });

  for (const t of TEACHER_TABLES) {
    const { error } = await db.from(t).update({ teacher_id: newId }).eq("teacher_id", oldId);
    if (error) throw new Error(`${t} 이관 실패: ${error.message}`);
  }

  const after = await countsFor(newId);
  const leftover = await countsFor(oldId);
  const ok = TEACHER_TABLES.every((t) => after[t] === before[t] && leftover[t] === 0);
  console.log(`  이관 후: ${Object.entries(after).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (!ok) throw new Error("이관 검증 실패 — 옛 계정을 지우지 않고 중단합니다");

  await db.auth.admin.deleteUser(oldId);
  console.log(`  옛 계정 삭제 완료 (데이터 전량 이관 확인됨)`);
}

async function remove() {
  const all = await users();
  const st = all.find((u) => u.email === toEmail(STUDENT.id));
  if (st) {
    await db.auth.admin.deleteUser(st.id);
    console.log(`${STUDENT.id}: 삭제됨`);
  } else console.log(`${STUDENT.id}: 없음`);
  console.log(
    `강사 ${TEACHER.id}: 실제 강사 계정이라 지우지 않음. 비밀번호를 바꾸려면 Supabase에서 직접 변경하세요.`
  );
}

async function main() {
  if (process.argv.includes("--remove")) return remove();

  const owner = await contentOwner();
  if (!owner) throw new Error("강사 없음 — scripts/seed.ts 먼저 실행");
  console.log(`대상 강사: ${owner.name} (자료 ${owner.docs}건)`);

  const teacherEmail = toEmail(TEACHER.id);
  const all = await users();

  // 같은 이메일을 쓰는 빈 계정이 있으면 정리 (이메일 유일 제약 회피). 자료가 있으면 중단.
  const holder = all.find((u) => u.email === teacherEmail);
  if (holder && holder.id !== owner.id) {
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("teacher_id", holder.id);
    if ((count ?? 0) > 0) throw new Error(`중단: ${teacherEmail} 계정에 자료 ${count}건이 있습니다`);
    await db.auth.admin.deleteUser(holder.id);
    console.log(`빈 계정 정리: ${teacherEmail}`);
  }

  const { error } = await db.auth.admin.updateUserById(owner.id, {
    email: teacherEmail,
    password: TEACHER.pw,
    email_confirm: true,
  });
  if (error) {
    // Supabase는 updateUser에만 최소 길이(6자)를 강제하고 createUser에는 안 건다.
    // 짧은 데모 비밀번호를 쓰려면 새 계정을 만들고 강사 데이터를 그 uid로 옮기는 수밖에 없다.
    if (!/at least|length/i.test(error.message)) throw new Error(`강사 자격 설정 실패: ${error.message}`);
    console.log(`업데이트 경로 막힘(${error.message}) → 계정 이관으로 진행`);
    await migrateTeacher(owner.id, owner.name, owner.academy_id!, teacherEmail);
  }
  console.log(`${TEACHER.id} / ${TEACHER.pw} — ${owner.name}`);

  // 학생
  const studentEmail = toEmail(STUDENT.id);
  let sid = (await users()).find((u) => u.email === studentEmail)?.id ?? null;
  if (sid) {
    await db.auth.admin.updateUserById(sid, { password: STUDENT.pw });
  } else {
    const { data, error: serr } = await db.auth.admin.createUser({
      email: studentEmail,
      password: STUDENT.pw,
      email_confirm: true,
    });
    if (serr) throw new Error(`학생 생성 실패: ${serr.message}`);
    sid = data.user!.id;
  }
  await db.from("profiles").upsert({ id: sid, academy_id: owner.academy_id, role: "student", name: STUDENT.name });
  const n = await enrollToAcademyTeachers(db, sid, owner.academy_id!);
  console.log(`${STUDENT.id} / ${STUDENT.pw} — ${STUDENT.name} (강사 ${n}명 수강 연결)`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
