import type { serviceClient } from "./supabase";

const DEFAULT_ACADEMY_SLUG = process.env.DEFAULT_ACADEMY_SLUG || "default";
const DEFAULT_ACADEMY_NAME = process.env.DEFAULT_ACADEMY_NAME || "우리학원";

// 학원 조회, 없으면 생성. slug 미지정 시 기본 학원 (단일 학원 배포 기준). 강사/학생 가입 공용.
// 신규 slug 생성은 초대코드로 이미 게이트됨 (강사 가입 경로에서만 유입).
export async function resolveAcademy(
  db: ReturnType<typeof serviceClient>,
  slug?: string | null
): Promise<string> {
  const s = (slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || DEFAULT_ACADEMY_SLUG;
  const name = s === DEFAULT_ACADEMY_SLUG ? DEFAULT_ACADEMY_NAME : s;
  const { data } = await db.from("academies").select("id").eq("slug", s).maybeSingle();
  if (data) return data.id;
  const { data: made, error } = await db
    .from("academies")
    .insert({ slug: s, name })
    .select("id")
    .single();
  if (error) {
    // 동시 가입 경합으로 unique(slug) 충돌 가능 — 재조회로 흡수
    const { data: again } = await db.from("academies").select("id").eq("slug", s).maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return made.id;
}
