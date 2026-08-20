import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { resolveAcademy } from "@/lib/academy";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyInviteCode, resolveStudentInvite } from "@/lib/invite";
import { toEmail, isValidId, enrollStudentToTeacher } from "@/lib/account";

// 가입. email_confirm: true로 메일 인증 생략.
// - admin(원장): 학원 이름으로 새 학원 개설 + admin 프로필 즉시 생성
// - teacher: 원장 초대 코드(teacherInviteCode) 또는 전역 INVITE_CODE
// - student: 이름만 (초대 링크 경유 시 /api/join이 수강 연결)
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  // 아이디 또는 이메일 — 아이디면 내부 이메일로 매핑 (@ 없으면 아이디로 취급)
  const rawId = (body?.email ?? body?.id ?? "").toString().trim();
  // 가입은 **아이디만** 받는다 (전 역할). 이메일 주소를 그대로 계정으로 쓰면
  // 화면 문구·검증이 두 갈래로 갈라지고, 학원 현장에선 이메일 없는 학생이 많다.
  // 로그인은 기존 이메일 계정도 계속 되도록 toEmail()이 @ 유무를 그대로 통과시킨다.
  if (rawId.includes("@"))
    return NextResponse.json({ error: "이메일이 아니라 아이디로 가입해 주세요 (영문·숫자 2~30자)" }, { status: 400 });
  if (rawId && !isValidId(rawId))
    return NextResponse.json({ error: "아이디는 영문·숫자와 . _ - 를 써서 2~30자로 지어 주세요" }, { status: 400 });
  const email = rawId ? toEmail(rawId) : "";
  const inviteCode = (body?.inviteCode ?? "").toString().trim();
  const teacherInviteCode = (body?.teacherInviteCode ?? "").toString().trim();
  // 학생이 강사에게 받은 초대코드 (선택). 넣으면 그 강사의 학원으로 소속이 정해진다
  const studentInviteCode = (body?.studentInviteCode ?? "").toString().trim();
  const role = body?.role === "student" ? "student" : body?.role === "admin" ? "admin" : "teacher";
  // 학생 가입 간소화: 비밀번호 대신 휴대폰을 받으면 **뒷 4자리**를 초기 비밀번호로 쓴다.
  // 4자리 숫자는 같은 반 친구도 아는 정보라 그대로 두면 위험하다 →
  // must_change_password=true로 표시해 첫 로그인에서 반드시 바꾸게 한다.
  const phone = (body?.phone ?? "").toString().trim().slice(0, 30);
  const phoneDigits = phone.replace(/\D/g, "");
  const usePhonePw = role === "student" && !body?.password && phoneDigits.length >= 4;
  const password = usePhonePw ? phoneDigits.slice(-4) : (body?.password ?? "").toString();

  const name = (body?.name ?? "").toString().trim();
  const academyName = (body?.academyName ?? "").toString().trim().slice(0, 50);
  const academySlug = (body?.academySlug ?? "").toString().trim() || null;

  // 대량 계정 생성 방어. 학원은 공인 IP 하나를 30명이 함께 쓰므로(교실 단체 가입)
  // IP당 5회로 잡으면 온보딩 첫날 6번째 학생부터 막힌다.
  // 초대 코드는 HMAC 서명이라 위조가 안 되니, 코드를 들고 온 가입은 한도를 넉넉히 준다.
  const invited = Boolean(studentInviteCode || teacherInviteCode);
  const limit = process.env.NODE_ENV !== "production" ? 100 : invited ? 60 : 5;
  if (!rateLimit(`signup:${invited ? "inv:" : ""}${clientIp(req)}`, limit, 3_600_000))
    return NextResponse.json({ error: "가입 시도가 너무 잦아요. 잠시 후 다시" }, { status: 429 });

  if (!email || !password)
    return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요" }, { status: 400 });
  if (!usePhonePw && password.length < 8)
    return NextResponse.json({ error: "비밀번호는 8자 이상" }, { status: 400 });
  if (role === "student" && !body?.password && !usePhonePw)
    return NextResponse.json(
      { error: "휴대폰 번호를 입력해 주세요 (뒷 4자리가 첫 비밀번호가 돼요)" },
      { status: 400 }
    );

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
  let invitedEnroll: { teacherId: string; courseId: string | null } | null = null;
  if (role === "student" && studentInviteCode) {
    // 강사 코드(s)·강좌 ROOM 코드(c) 둘 다 수용 — 학원 소속은 어느 쪽이든 그 강사의 학원
    const inv = await resolveStudentInvite(db, studentInviteCode);
    if (!inv)
      return NextResponse.json({ error: "선생님 초대코드가 올바르지 않아요" }, { status: 403 });
    invitedEnroll = { teacherId: inv.teacherId, courseId: inv.courseId };
    const { data: t } = await db
      .from("profiles")
      .select("academy_id")
      .eq("id", inv.teacherId)
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
    // GoTrue 원문에는 내부 설정·DB 상태가 섞여 나온다. 비인증 엔드포인트라 원문을 흘리지 않는다.
    if (/already/i.test(error.message))
      return NextResponse.json({ error: "이미 가입된 계정이에요. 로그인으로 진행해 주세요." }, { status: 400 });
    console.error("signup createUser:", error.message);
    return NextResponse.json({ error: "가입하지 못했어요. 입력을 확인해 주세요." }, { status: 400 });
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
    if (academy.error) {
      console.error("signup academy insert:", academy.error.message);
      return NextResponse.json({ error: "학원을 만들지 못했어요." }, { status: 500 });
    }
    const { error: perr } = await db
      .from("profiles")
      .upsert({ id: uid, academy_id: academy.data.id, role: "admin", name: name || "원장" });
    if (perr) {
      console.error("signup admin profile:", perr.message);
      return NextResponse.json({ error: "계정을 만들지 못했어요." }, { status: 500 });
    }
  }

  if (role === "student" && uid) {
    // 초대코드로 온 학생은 그 선생님의 학원으로. 없으면 slug(또는 기본 학원)
    const academyId = invitedTeacherAcademyId ?? (await resolveAcademy(db, academySlug));
    const { error: perr } = await db
      .from("profiles")
      .upsert({
        id: uid,
        academy_id: academyId,
        role: "student",
        name,
        // 뒷 4자리를 그대로 쓴다 — 첫 로그인 변경 강제는 학생들이 번거로워 뺐다 (2026-08-20 결정).
        // 대리 응시 위험은 감수. 되살리려면 usePhonePw로 되돌리면 된다.
        must_change_password: false,
      });
    if (perr) {
      console.error("signup student profile:", perr.message);
      return NextResponse.json({ error: "계정을 만들지 못했어요." }, { status: 500 });
    }
    // 받은 휴대폰은 학생 상세정보로 — 강사가 따로 입력하지 않아도 되게
    if (phoneDigits) {
      const { error: derr } = await db
        .from("student_details")
        // 하이픈 등 서식이 섞여 와도 숫자만 저장 — 검색·중복 확인이 일관되게
        .upsert({ student_id: uid, phone: phoneDigits, updated_by: uid }, { onConflict: "student_id" });
      if (derr) console.error("signup student phone:", derr.message);
    }
    // 초대코드로 온 학생만 그 강사(또는 ROOM)에 수강 연결.
    // 코드 없는 가입은 아무도 연결하지 않는다 — /ask의 "선생님 코드 입력"으로 직접 등록 (2026-08-20)
    if (invitedEnroll) await enrollStudentToTeacher(db, uid, invitedEnroll.teacherId, academyId, invitedEnroll.courseId);
  }

  return NextResponse.json({ ok: true, userId: uid });
}
