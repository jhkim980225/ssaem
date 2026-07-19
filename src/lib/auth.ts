import { createClient } from "@supabase/supabase-js";

// Authorization: Bearer <supabase access_token> 검증 → teacher(user) id.
export async function teacherFromRequest(req: Request): Promise<string | null> {
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
