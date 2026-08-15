import type { serviceClient } from "./supabase";

// 플랜 게이팅 (docs/수익화-플랜.md). 강제는 여기+각 API에서만, UI는 안내만.
export const FREE_LIMITS = {
  docsPerTeacher: 10, // 무료: 강사당 자료 수
  questionsPerDay: 50, // 무료: 학원당 일 질문 수
} as const;

export type Plan = "free" | "pro";

type Db = ReturnType<typeof serviceClient>;

// 무료 일일 질문 한도의 '오늘'은 KST(UTC+9) 자정 기준.
// 서버(Vercel=UTC) 로컬 자정을 쓰면 한국 학생 입장에선 오전 9시에 리셋돼 밤에 억울하게 막혔다.
const KST_OFFSET = 9 * 3600_000;
function kstDayStartIso(): string {
  const shifted = Date.now() + KST_OFFSET; // UTC epoch → KST 벽시계 epoch
  const kstMidnight = Math.floor(shifted / 86_400_000) * 86_400_000; // KST 자정
  return new Date(kstMidnight - KST_OFFSET).toISOString(); // 다시 UTC 시각으로
}

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

  const { count } = await db
    .from("messages")
    .select("id, conversations!inner(teacher_id)", { count: "exact", head: true })
    .eq("role", "user")
    .in("conversations.teacher_id", ids)
    .gte("created_at", kstDayStartIso());
  if ((count ?? 0) >= FREE_LIMITS.questionsPerDay)
    return `오늘 무료 질문 한도(${FREE_LIMITS.questionsPerDay}건)를 모두 썼어요. 내일 다시 시도하거나 원장님께 Pro 도입을 요청해 주세요.`;
  return null;
}

// 대시보드용 사용량. 강사·원장이 "지금 얼마나 썼는지"를 보려면 필요하다 —
// 예전엔 한도 초과를 버튼을 눌러 실패해야만 알 수 있었다.
// Pro는 한도가 없으므로 limit=null (사용량은 그대로 보여준다).
export type Usage = {
  plan: Plan;
  documents: { used: number; limit: number | null };
  questionsToday: { used: number; limit: number | null };
};

export async function usageFor(
  db: Db,
  opts: { academyId: string | null; teacherId?: string }
): Promise<Usage> {
  const { academyId, teacherId } = opts;
  let plan: Plan = "free";
  if (academyId) {
    const { data } = await db.from("academies").select("plan").eq("id", academyId).maybeSingle();
    if (data?.plan === "pro") plan = "pro";
  }

  // 학원 강사 전원 (질문 한도는 학원 단위)
  const { data: ts } = academyId
    ? await db.from("profiles").select("id").eq("academy_id", academyId).eq("role", "teacher")
    : { data: [] as { id: string }[] };
  const ids = (ts ?? []).map((t) => t.id);

  const dayStartIso = kstDayStartIso();

  const [docRes, qRes] = await Promise.all([
    teacherId
      ? db.from("documents").select("id", { count: "exact", head: true }).eq("teacher_id", teacherId)
      : Promise.resolve({ count: 0 }),
    ids.length
      ? db
          .from("messages")
          .select("id, conversations!inner(teacher_id)", { count: "exact", head: true })
          .eq("role", "user")
          .in("conversations.teacher_id", ids)
          .gte("created_at", dayStartIso)
      : Promise.resolve({ count: 0 }),
  ]);

  const free = plan === "free";
  return {
    plan,
    documents: {
      used: docRes.count ?? 0,
      limit: free && teacherId ? FREE_LIMITS.docsPerTeacher : null,
    },
    questionsToday: { used: qRes.count ?? 0, limit: free ? FREE_LIMITS.questionsPerDay : null },
  };
}
