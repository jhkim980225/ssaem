import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { verifyInviteCode } from "@/lib/invite";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// GET ?code= — 원장 강사-초대 코드 검증 + 학원 미리보기 (가입 전 화면용)
export async function GET(req: Request) {
  if (!rateLimit(`join-teacher:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  const adminId = verifyInviteCode(code, "t");
  if (!adminId) return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 404 });

  const db = serviceClient();
  const { data } = await db
    .from("profiles")
    .select("name, academies(name)")
    .eq("id", adminId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "학원을 찾을 수 없어요" }, { status: 404 });

  const academy = Array.isArray(data.academies) ? data.academies[0] : data.academies;
  return NextResponse.json({ academy: academy?.name ?? "", adminName: data.name });
}
