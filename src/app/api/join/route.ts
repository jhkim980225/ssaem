import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";
import { verifyInviteCode } from "@/lib/invite";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const DEFAULT_COURSE = "기본반"; // 초대 수강 연결용 강좌 (없으면 자동 생성)

// GET ?code= — 코드 검증 + 강사 미리보기 (가입 전 화면용, 인증 불필요)
export async function GET(req: Request) {
  if (!rateLimit(`join-check:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  const teacherId = verifyInviteCode(code);
  if (!teacherId) return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 404 });

  const db = serviceClient();
  const { data } = await db
    .from("profiles")
    .select("id, name, teacher_profiles(subject)")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "강사를 찾을 수 없어요" }, { status: 404 });

  const tp = Array.isArray(data.teacher_profiles) ? data.teacher_profiles[0] : data.teacher_profiles;
  return NextResponse.json({ teacher: { id: data.id, name: data.name, subject: tp?.subject ?? null } });
}

// POST {code} — 로그인한 학생을 강사의 기본반에 수강 연결
export async function POST(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const teacherId = verifyInviteCode((body?.code ?? "").toString());
  if (!teacherId) return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 404 });

  const db = serviceClient();
  const { data: teacher } = await db
    .from("profiles")
    .select("id, academy_id")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  if (!teacher) return NextResponse.json({ error: "강사를 찾을 수 없어요" }, { status: 404 });

  // 기본반 확보
  let { data: course } = await db
    .from("courses")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("title", DEFAULT_COURSE)
    .maybeSingle();
  if (!course) {
    const { data: made, error } = await db
      .from("courses")
      .insert({ academy_id: teacher.academy_id, teacher_id: teacherId, title: DEFAULT_COURSE })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    course = made;
  }

  // 수강 연결 (중복 무시)
  const { error: eerr } = await db
    .from("enrollments")
    .upsert({ course_id: course.id, student_id: uid }, { onConflict: "course_id,student_id" });
  if (eerr) return NextResponse.json({ error: eerr.message }, { status: 500 });

  return NextResponse.json({ ok: true, teacherId });
}
