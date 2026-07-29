import { createClient } from "@supabase/supabase-js";

// Authorization: Bearer <supabase access_token> 검증 → user id.
// role 검사 없음 — 강사/학생 공용. 소유권은 각 쿼리의 eq 필터로 강제.
export async function userFromRequest(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

// 기존 호출부 호환 별칭
export const teacherFromRequest = userFromRequest;
