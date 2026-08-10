import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { resolveAcademy } from "@/lib/academy";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyInviteCode } from "@/lib/invite";
import { toEmail, isValidId, enrollToAcademyTeachers } from "@/lib/account";

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
  // 아이디 또는 이메일 — 아이디면 내부 이메일로 매핑 (@ 없으면 아이디로 취급)
  const rawId = (body?.email ?? body?.id ?? "").toString().trim();
  if (rawId && !rawId.includes("@") && !isValidId(rawId))
    return NextResponse.json({ error: "아이디는 영문·숫자 2~30자로 지어 주세요" }, { status: 400 });
  const email = rawId ? toEmail(rawId) : "";
  const password = (body?.password ?? "").toString();
  const inviteCode = (body?.inviteCode ?? "").toString().trim();
  const teacherInviteCode = (body?.teacherInviteCode ?? "").toString().trim();
  // 학생이 강사에게 받은 초대코드 (선택). 넣으면 그 강사의 학원으로 소속이 정해진다
  const studentInviteCode = (body?.studentInviteCode ?? "").toString().trim();
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
  // 학생 초대코드: 계정을 만들기 전에 검증해야 실패 시 유령 계정이 안 남는다
  let invitedTeacherAcademyId: string | null = null;
  if (role === "student" && studentInviteCode) {
    const teacherId = verifyInviteCode(studentInviteCode);
    if (!teacherId)
      return NextResponse.json({ error: "선생님 초대코드가 올바르지 않아요" }, { status: 403 });
    const { data: t } = await db
      .from("profiles")
      .select("academy_id")
      .eq("id", teacherId)
      .eq("role", "teacher")
      .maybeSingle();
    if (!t?.academy_id)
      return NextResponse.json({ error: "초대한 선생님을 찾을 수 없어요" }, { status: 404 });
    invitedTeacherAcademyId = t.academy_id;
  }

  if (role === "admin") {
    if (!academyName) return NextResponse.json({ error: "학원 이름을 입력하세요" }, { status: 400 });
    // 학원 개설도 초대코드로 게이트 — 공개 배포에서 누구나 학원을 만드는 것 차단
    const required = process.env.INVITE_CODE;
    if (required && inviteCode !== required)
      return NextResponse.json({ error: "학원 개설 코드가 올바르지 않아요" }, { status: 403 });
  }

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
    // 초대코드로 온 학생은 그 선생님의 학원으로. 없으면 slug(또는 기본 학원)
    const academyId = invitedTeacherAcademyId ?? (await resolveAcademy(db, academySlug));
    const { error: perr } = await db
      .from("profiles")
      .upsert({ id: uid, academy_id: academyId, role: "student", name });
    if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });
    // 학원 강사들에게 자동 수강 연결 — 가입 직후 빈 강사 목록을 보지 않게
    await enrollToAcademyTeachers(db, uid, academyId);
  }

  return NextResponse.json({ ok: true, userId: uid });
}
