import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { resolveAcademy } from "@/lib/academy";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 가입. 강사는 INVITE_CODE 일치 필요(스팸/무단 가입 차단), 학생은 초대코드 없이 이름만.
// email_confirm: true로 만들어서 메일 인증 불필요.
export async function POST(req: Request) {
  // 대량 계정 생성 방어 — IP당 시간당 5회
  if (!rateLimit(`signup:${clientIp(req)}`, 5, 3_600_000))
    return NextResponse.json({ error: "가입 시도가 너무 잦아요. 잠시 후 다시" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const email = (body?.email ?? "").toString().trim();
  const password = (body?.password ?? "").toString();
  const inviteCode = (body?.inviteCode ?? "").toString().trim();
  const role = body?.role === "student" ? "student" : "teacher";
  const name = (body?.name ?? "").toString().trim();

  if (!email || !password)
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요" }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json({ error: "비밀번호는 8자 이상" }, { status: 400 });

  if (role === "teacher") {
    const required = process.env.INVITE_CODE;
    if (!required) {
      console.warn("INVITE_CODE 미설정 — 가입이 열려 있음 (개발 모드)");
    } else if (inviteCode !== required) {
      return NextResponse.json({ error: "초대코드가 올바르지 않아요" }, { status: 403 });
    }
  } else if (!name) {
    return NextResponse.json({ error: "이름을 입력하세요" }, { status: 400 });
  }

  const db = serviceClient();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    const msg = /already/i.test(error.message) ? "이미 가입된 이메일이에요" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 학생은 프로필까지 즉시 생성 (강사는 대시보드에서 이름·과목 입력 시 생성)
  if (role === "student" && data.user) {
    const academyId = await resolveAcademy(db);
    const { error: perr } = await db
      .from("profiles")
      .upsert({ id: data.user.id, academy_id: academyId, role: "student", name });
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: data.user?.id });
}
