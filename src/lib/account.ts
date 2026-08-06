import type { serviceClient } from "./supabase";

// 아이디 로그인 지원. Supabase Auth는 이메일만 받으므로 아이디를 내부 이메일로 매핑한다.
// 실제 수신 가능한 주소가 아니므로 이 계정은 비밀번호 재설정 메일을 못 받는다 — 학원 계정은 이메일 가입 권장.
export const ID_DOMAIN = "ssaem.kr";

// "test" → "test@ssaem.kr", "a@b.com" → 그대로. 학생·강사가 이메일 없이도 쓸 수 있게.
export function toEmail(idOrEmail: string): string {
  const v = idOrEmail.trim().toLowerCase();
  return v.includes("@") ? v : `${v}@${ID_DOMAIN}`;
}

// 아이디 형식: 영문/숫자/._- 2~30자
export function isValidId(v: string): boolean {
  return /^[a-z0-9._-]{2,30}$/i.test(v.trim());
}

const DEFAULT_COURSE = "기본반";

// 학생을 학원의 모든 강사 기본반에 수강 연결. 가입 직후 바로 질문할 수 있게.
// 초대 코드 없이 가입한 학생은 강사가 아무도 안 잡혀 빈 화면을 보게 되는 문제를 막는다.
export async function enrollToAcademyTeachers(
  db: ReturnType<typeof serviceClient>,
  studentId: string,
  academyId: string
): Promise<number> {
  const { data: teachers } = await db
    .from("profiles")
    .select("id")
    .eq("academy_id", academyId)
    .eq("role", "teacher");
  if (!teachers?.length) return 0;

  let linked = 0;
  for (const t of teachers) {
    let { data: course } = await db
      .from("courses")
      .select("id")
      .eq("teacher_id", t.id)
      .eq("title", DEFAULT_COURSE)
      .maybeSingle();
    if (!course) {
      const { data: made } = await db
        .from("courses")
        .insert({ academy_id: academyId, teacher_id: t.id, title: DEFAULT_COURSE })
        .select("id")
        .single();
      course = made ?? null;
    }
    if (!course) continue;
    const { error } = await db
      .from("enrollments")
      .upsert({ course_id: course.id, student_id: studentId }, { onConflict: "course_id,student_id" });
    if (!error) linked++;
  }
  return linked;
}
