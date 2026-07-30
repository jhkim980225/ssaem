import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { resolveAcademy } from "@/lib/academy";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyInviteCode } from "@/lib/invite";

// 가입. email_confirm: true로 메일 인증 생략.
// - admin(원장): 학원 이름으로 새 학원 개설 + admin 프로필 즉시 생성
// - teacher: 원장 초대 코드(teacherInviteCode) 또는 전역 INVITE_CODE
// - student: 이름만 (초대 링크 경유 시 /api/join이 수강 연결)
export async function POST(req: Request) {
  // 대량 계정 생성 방어 — IP당 시간당 5회 (dev는 100 — e2e 반복 실행용)
  const limit = process.env.NODE_ENV === "production" ? 5 : 100;
  if (!rateLimit(`signup:${clientIp(req)}`, limit, 3_600_000))
    return NextResponse.json({ error: "가입 시도가 너무 잦아요. 잠시 후 다시" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const email = (body?.email ?? "").toString().trim();
  const password = (body?.password ?? "").toString();
  const inviteCode = (body?.inviteCode ?? "").toString().trim();
  const teacherInviteCode = (body?.teacherInviteCode ?? "").toString().trim();
  const role = body?.role === "student" ? "student" : body?.role === "admin" ? "admin" : "teacher";
  const name = (body?.name ?? "").toString().trim();
  const academyName = (body?.academyName ?? "").toString().trim().slice(0, 50);
  const academySlug = (body?.academySlug ?? "").toString().trim() || null;

  if (!email || !password)
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요" }, { status: 400 });
  if (password.length < 8)
    return NextResponse.json({ error: "비밀번호는 8자 이상" }, { status: 400 });

  const db = serviceClient();

  // 강사: 원장 초대 코드가 있으면 그 학원 소속, 없으면 전역 INVITE_CODE 검사
  let invitedAcademyId: string | null = null;
  if (role === "teacher") {
    if (teacherInviteCode) {
      const adminId = verifyInviteCode(teacherInviteCode, "t");
      if (!adminId)
        return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 403 });
      const { data: adm } = await db
        .from("profiles")
        .select("academy_id")
        .eq("id", adminId)
        .eq("role", "admin")
        .maybeSingle();
      if (!adm?.academy_id)
        return NextResponse.json({ error: "초대한 학원을 찾을 수 없어요" }, { status: 404 });
      invitedAcademyId = adm.academy_id;
    } else {
      const required = process.env.INVITE_CODE;
      if (!required) {
        console.warn("INVITE_CODE 미설정 — 가입이 열려 있음 (개발 모드)");
      } else if (inviteCode !== required) {
        return NextResponse.json({ error: "초대코드가 올바르지 않아요" }, { status: 403 });
      }
    }
  } else if (!name) {
    return NextResponse.json({ error: "이름을 입력하세요" }, { status: 400 });
  }
  if (role === "admin" && !academyName)
    return NextResponse.json({ error: "학원 이름을 입력하세요" }, { status: 400 });

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    // 프로필 저장 시 소속 결정용 (초대 학원 id 우선, 없으면 slug)
    user_metadata: invitedAcademyId
      ? { academy_id: invitedAcademyId }
      : academySlug
        ? { academy_slug: academySlug }
        : undefined,
  });
  if (error) {
    const msg = /already/i.test(error.message) ? "이미 가입된 이메일이에요" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const uid = data.user?.id;

  if (role === "admin" && uid) {
    // 학원 개설: slug는 자동 생성 (충돌 시 재시도 1회)
    const mkSlug = () => `a${Math.random().toString(36).slice(2, 8)}`;
    let academy = await db
      .from("academies")
      .insert({ name: academyName, slug: mkSlug() })
      .select("id")
      .single();
    if (academy.error)
      academy = await db
        .from("academies")
        .insert({ name: academyName, slug: mkSlug() })
        .select("id")
        .single();
    if (academy.error) return NextResponse.json({ error: academy.error.message }, { status: 500 });
    const { error: perr } = await db
      .from("profiles")
      .upsert({ id: uid, academy_id: academy.data.id, role: "admin", name: name || "원장" });
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  }

  if (role === "student" && uid) {
    const academyId = await resolveAcademy(db, academySlug);
    const { error: perr } = await db
      .from("profiles")
      .upsert({ id: uid, academy_id: academyId, role: "student", name });
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId: uid });
}
