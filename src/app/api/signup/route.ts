import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

// 강사 가입. INVITE_CODE 일치해야 계정 생성 (스팸/무단 가입 차단).
// email_confirm: true로 만들어서 메일 인증 불필요.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = (body?.email ?? "").toString().trim();
  const password = (body?.password ?? "").toString();
  const inviteCode = (body?.inviteCode ?? "").toString().trim();

  if (!email || !password)
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요" }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "비밀번호는 6자 이상" }, { status: 400 });

  const required = process.env.INVITE_CODE;
  if (!required) {
    console.warn("INVITE_CODE 미설정 — 가입이 열려 있음 (개발 모드)");
  } else if (inviteCode !== required) {
    return NextResponse.json({ error: "초대코드가 올바르지 않아요" }, { status: 403 });
  }

  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) {
    const msg = /already/i.test(error.message) ? "이미 가입된 이메일이에요" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true, userId: data.user?.id });
}
