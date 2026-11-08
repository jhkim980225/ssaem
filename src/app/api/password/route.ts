import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { authPassword } from "@/lib/account";

// 본인 비밀번호 변경.
//
// 학생 가입은 휴대폰 뒷 4자리를 초기 비밀번호로 쓴다(가입 간소화). 그대로 두면
// 같은 반 친구가 남의 계정으로 들어갈 수 있으므로, 첫 로그인에서 이 API로 바꾸게 하고
// profiles.must_change_password를 내린다.
//
// current(현재 비밀번호): 학생은 필수(초기 비번 강제 변경 상태 제외) — 켜 둔 기기에서
// 남이 비번을 바꿔 계정을 뺏는 걸 막는다. 강사 설정 화면은 아직 안 보내므로 강사는 보낼 때만 검사.

const MIN = 8;

export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;

  // 무차별 변경 시도 방어
  if (!rateLimit(`password:${g.uid}`, 10, 60_000))
    return NextResponse.json({ error: "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const password = (body?.password ?? "").toString();
  if (password.length < MIN)
    return NextResponse.json({ error: `비밀번호는 ${MIN}자 이상으로 정해 주세요.` }, { status: 400 });
  // 숫자만 4~8자리는 휴대폰 뒷자리·생일 같은 추측 가능한 값이다 — 첫 변경의 목적이 사라진다
  if (/^\d+$/.test(password))
    return NextResponse.json(
      { error: "숫자만으로는 안 돼요. 영문을 섞어 주세요." },
      { status: 400 }
    );

  const db = serviceClient();
  const current = typeof body?.current === "string" ? body.current : "";
  const { data: me } = await db.from("profiles").select("role, must_change_password").eq("id", g.uid).maybeSingle();
  if (current || (me?.role === "student" && me.must_change_password !== true)) {
    if (!current) return NextResponse.json({ error: "현재 비밀번호를 입력해 주세요." }, { status: 400 });
    // 현재 비번 대입 방어 — 변경 한도(10/분)보다 촘촘하게
    if (!rateLimit(`password-check:${g.uid}`, 5, 10 * 60_000))
      return NextResponse.json({ error: "확인 시도가 너무 잦아요. 10분 뒤 다시 시도해 주세요." }, { status: 429 });
    if (current === password)
      return NextResponse.json({ error: "지금 비밀번호와 다른 비밀번호로 정해 주세요." }, { status: 400 });
    const { data: au } = await db.auth.admin.getUserById(g.uid);
    const email = au?.user?.email;
    // 아이디 계정도 내부 이메일(<id>@ssaem.kr)이 있으니 같은 방식으로 확인된다
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { error: verr } = email
      ? await anon.auth.signInWithPassword({ email, password: authPassword(current) })
      : { error: new Error("no email") };
    if (verr) return NextResponse.json({ error: "현재 비밀번호가 맞지 않아요." }, { status: 400 });
    // 확인용으로 생긴 세션만 닫는다 (global이면 지금 쓰는 기기도 로그아웃된다)
    await anon.auth.signOut({ scope: "local" }).catch(() => {});
  }

  const { error } = await db.auth.admin.updateUserById(g.uid, { password });
  if (error) {
    console.error("password update:", error.message);
    return NextResponse.json({ error: "비밀번호를 바꾸지 못했어요." }, { status: 500 });
  }

  // 플래그 해제 (프로필이 없을 수도 있으므로 실패해도 변경 자체는 성공으로 둔다)
  const { error: perr } = await db
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", g.uid);
  if (perr) console.error("password flag clear:", perr.message);

  return NextResponse.json({ ok: true });
}
