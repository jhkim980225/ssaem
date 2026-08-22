import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { serviceClient } from "./supabase";

export type Role = "teacher" | "student" | "admin" | "dev";

// Authorization: Bearer <supabase access_token> 검증 → user id.
// role 검사 없음 — 공개/공용 라우트용. 역할이 걸린 라우트는 requireRole을 쓸 것.
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

// 기존 호출부 호환 별칭 (role 검사 없음 — 이름에 속지 말 것)
export const teacherFromRequest = userFromRequest;

// uid + DB의 실제 role. 프로필이 없으면 role은 null (강사 가입 직후 첫 프로필 저장 전 상태).
export async function userWithRole(
  req: Request
): Promise<{ uid: string; role: Role | null } | null> {
  const uid = await userFromRequest(req);
  if (!uid) return null;
  const { data } = await serviceClient().from("profiles").select("role").eq("id", uid).maybeSingle();
  return { uid, role: (data?.role as Role | undefined) ?? null };
}

// 로그인만 요구 (역할 무관). 학생·강사·원장 누구나 쓰는 라우트용.
//
//   const g = await requireUser(req);
//   if ("res" in g) return g.res;
//
export async function requireUser(req: Request): Promise<{ uid: string } | { res: NextResponse }> {
  const uid = await userFromRequest(req);
  if (!uid)
    return { res: NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 }) };
  return { uid };
}

const DENY: Record<Role, string> = {
  teacher: "강사 계정만 쓸 수 있어요",
  admin: "원장 계정만 쓸 수 있어요",
  student: "학생 계정만 쓸 수 있어요",
  dev: "개발자 계정만 쓸 수 있어요",
};

// 역할 게이트. 통과하면 uid를 주고, 막히면 그대로 반환할 NextResponse를 준다.
//
//   const g = await requireRole(req, "teacher");
//   if ("res" in g) return g.res;
//   // g.uid 사용
//
// allowNoProfile: 강사 가입 직후(프로필 생성 전)처럼 role이 아직 없는 상태를 허용할지.
export async function requireRole(
  req: Request,
  role: Role,
  opts: { allowNoProfile?: boolean } = {}
): Promise<{ uid: string } | { res: NextResponse }> {
  const me = await userWithRole(req);
  if (!me) return { res: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  if (me.role === role) return { uid: me.uid };
  if (me.role === null && opts.allowNoProfile) return { uid: me.uid };
  return { res: NextResponse.json({ error: DENY[role] }, { status: 403 }) };
}
