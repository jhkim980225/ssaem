import type { serviceClient } from "./supabase";

const DEFAULT_ACADEMY_SLUG = process.env.DEFAULT_ACADEMY_SLUG || "default";
const DEFAULT_ACADEMY_NAME = process.env.DEFAULT_ACADEMY_NAME || "우리학원";

// 기본 학원 조회, 없으면 생성 (단일 학원 배포 기준). 강사/학생 가입 공용.
export async function resolveAcademy(db: ReturnType<typeof serviceClient>): Promise<string> {
  const { data } = await db.from("academies").select("id").eq("slug", DEFAULT_ACADEMY_SLUG).maybeSingle();
  if (data) return data.id;
  const { data: made, error } = await db
    .from("academies")
    .insert({ slug: DEFAULT_ACADEMY_SLUG, name: DEFAULT_ACADEMY_NAME })
    .select("id")
    .single();
  if (error) throw error;
  return made.id;
}
