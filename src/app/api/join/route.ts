import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";
import { resolveStudentInvite } from "@/lib/invite";
import { enrollStudentToTeacher } from "@/lib/account";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// GET ?code= — 코드 검증 + 강사 미리보기 (가입 전 화면용, 인증 불필요)
export async function GET(req: Request) {
  if (!rateLimit(`join-check:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const code = new URL(req.url).searchParams.get("code") ?? "";
  const db = serviceClient();
  const inv = await resolveStudentInvite(db, code);
  if (!inv) return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 404 });

  const { data } = await db
    .from("profiles")
    .select("id, name, teacher_profiles(subject)")
    .eq("id", inv.teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "강사를 찾을 수 없어요" }, { status: 404 });

  const tp = Array.isArray(data.teacher_profiles) ? data.teacher_profiles[0] : data.teacher_profiles;
  return NextResponse.json({
    teacher: { id: data.id, name: data.name, subject: tp?.subject ?? null },
    course: inv.courseId ? { id: inv.courseId, title: inv.courseTitle } : null,
  });
}

// POST {code} — 로그인한 학생을 수강 연결.
// 강사 코드(s)면 기본반, 강좌 ROOM 코드(c)면 그 강좌로. 학생은 여러 ROOM에 등록될 수 있다
// (enrollments가 (course_id, student_id) 단위라 코드마다 한 줄씩 쌓인다).
export async function POST(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const db = serviceClient();
  const inv = await resolveStudentInvite(db, (body?.code ?? "").toString());
  if (!inv) return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 404 });

  const { data: teacher } = await db
    .from("profiles")
    .select("id, academy_id")
    .eq("id", inv.teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  if (!teacher) return NextResponse.json({ error: "강사를 찾을 수 없어요" }, { status: 404 });

  // ROOM 코드는 그 강좌, 강사 코드는 기본반(없으면 생성) — 가입 경로와 같은 헬퍼
  const okEnroll = await enrollStudentToTeacher(db, uid, inv.teacherId, teacher.academy_id, inv.courseId);
  if (!okEnroll) return NextResponse.json({ error: "수강 연결에 실패했어요" }, { status: 500 });

  return NextResponse.json({ ok: true, teacherId: inv.teacherId, courseId: inv.courseId });
}
