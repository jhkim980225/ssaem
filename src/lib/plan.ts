import type { serviceClient } from "./supabase";

// 플랜 게이팅 (docs/수익화-플랜.md). 강제는 여기+각 API에서만, UI는 안내만.
export const FREE_LIMITS = {
  docsPerTeacher: 10, // 무료: 강사당 자료 수
  questionsPerDay: 50, // 무료: 학원당 일 질문 수
} as const;

export type Plan = "free" | "pro";

type Db = ReturnType<typeof serviceClient>;

// 강사 uid → 학원 플랜. plan 컬럼 미마이그레이션·학원 미소속이면 free.
export async function planForTeacher(
  db: Db,
  teacherId: string
): Promise<{ plan: Plan; academyId: string | null }> {
  try {
    const { data } = await db
      .from("profiles")
      .select("academy_id, academies(plan)")
      .eq("id", teacherId)
      .maybeSingle();
    const academy = Array.isArray(data?.academies) ? data?.academies[0] : data?.academies;
    return {
      plan: academy?.plan === "pro" ? "pro" : "free",
      academyId: data?.academy_id ?? null,
    };
  } catch {
    return { plan: "free", academyId: null };
  }
}

// 자료 등록 한도. 통과면 null, 초과면 사용자 안내 메시지.
export async function docLimitError(db: Db, teacherId: string): Promise<string | null> {
  const { plan } = await planForTeacher(db, teacherId);
  if (plan === "pro") return null;
  const { count } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", teacherId);
  if ((count ?? 0) >= FREE_LIMITS.docsPerTeacher)
    return `무료 플랜은 자료 ${FREE_LIMITS.docsPerTeacher}건까지예요. 더 올리려면 원장님께 문의해 주세요.`;
  return null;
}

// 질문 한도 (학원 단위 일일). 통과면 null.
export async function askLimitError(db: Db, teacherId: string): Promise<string | null> {
  const { plan, academyId } = await planForTeacher(db, teacherId);
  if (plan === "pro" || !academyId) return null;

  const { data: ts } = await db
    .from("profiles")
    .select("id")
    .eq("academy_id", academyId)
    .eq("role", "teacher");
  const ids = (ts ?? []).map((t) => t.id);
  if (!ids.length) return null;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { count } = await db
    .from("messages")
    .select("id, conversations!inner(teacher_id)", { count: "exact", head: true })
    .eq("role", "user")
    .in("conversations.teacher_id", ids)
    .gte("created_at", dayStart.toISOString());
  if ((count ?? 0) >= FREE_LIMITS.questionsPerDay)
    return `오늘 무료 질문 한도(${FREE_LIMITS.questionsPerDay}건)를 모두 썼어요. 내일 다시 시도하거나 원장님께 Pro 도입을 요청해 주세요.`;
  return null;
}
