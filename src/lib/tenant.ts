import type { serviceClient } from "./supabase";

// 학원(테넌트) 경계 강제.
//
// 왜 필요한가: 역할 가드(`requireRole`)는 "학생이냐 강사냐"만 본다. 그래서 로그인한 학생이
// **남의 학원** 강사 uuid를 넣어 호출하면 그대로 통과했다. 실제로 이런 사슬이 가능했다:
//   GET /api/popular            → 학원 필터가 없어 전 학원 질문 원문 + 강사 uuid·실명 노출
//   GET /api/quiz?teacher=<그 uuid> → 남의 학원 문제 목록
//   POST /api/quiz/attempt      → 문항마다 정답·해설 반환
// = 계정 하나로 타 학원 정답표 수집. 역할별 교차 테스트(scripts/matrix.ts)는 역할만 보므로
//   이 계열을 잡지 못한다. 여기서 학원 일치를 강제한다.

type Db = ReturnType<typeof serviceClient>;

/** 호출자의 학원 id. 프로필이 없거나 미소속이면 null. */
export async function academyOf(db: Db, uid: string): Promise<string | null> {
  const { data } = await db.from("profiles").select("academy_id").eq("id", uid).maybeSingle();
  return data?.academy_id ?? null;
}

/** 그 학원 소속 강사 id 전부. */
export async function teacherIdsOf(db: Db, academyId: string): Promise<string[]> {
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("academy_id", academyId)
    .eq("role", "teacher");
  return (data ?? []).map((t) => t.id);
}

/**
 * 호출자와 대상 강사가 같은 학원인지. 강사 본인도 통과한다.
 * 학원 미소속 호출자는 어떤 강사에도 접근하지 못한다.
 */
export async function sameAcademy(db: Db, uid: string, teacherId: string): Promise<boolean> {
  if (uid === teacherId) return true;
  const mine = await academyOf(db, uid);
  if (!mine) return false;
  const { data } = await db
    .from("profiles")
    .select("academy_id")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  return Boolean(data?.academy_id) && data!.academy_id === mine;
}
