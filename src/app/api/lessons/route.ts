import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";

// 학생용 수업 달력: 강사가 날짜를 지정해 올린 자료 목록.
// 제목·날짜·강좌만 내려준다 — 원문(raw_text)은 RAG 근거용이라 학생에게 직접 노출하지 않는다.
// 학생은 수강 연결된 ROOM 수업 + 공용(course_id null)만 — 다른 ROOM 수업은 안 보인다.
// GET ?teacher=<id> (인증 필수, 같은 학원만)
export async function GET(req: Request) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 });

  const teacher = new URL(req.url).searchParams.get("teacher");
  if (!teacher || !/^[0-9a-f-]{36}$/i.test(teacher))
    return NextResponse.json({ error: "teacher required" }, { status: 400 });

  const db = serviceClient();
  // 다른 학원 강사면 목록만 비워서 반환 (courses API와 같은 테넌트 경계 처리)
  if (!(await sameAcademy(db, me.uid, teacher))) return NextResponse.json({ lessons: [] });

  let q = db
    .from("documents")
    .select("id, title, summary, lesson_date, course_id, courses(title)")
    .eq("teacher_id", teacher)
    .not("lesson_date", "is", null)
    .order("lesson_date", { ascending: false });
  if (me.role === "student") {
    const { data: enr } = await db
      .from("enrollments")
      .select("course_id, courses!inner(teacher_id)")
      .eq("student_id", me.uid)
      .eq("courses.teacher_id", teacher);
    const myCourseIds = ((enr ?? []) as { course_id: string }[]).map((e) => e.course_id);
    // 내 ROOM 수업 + 강좌 미지정(공용) 수업만
    q = myCourseIds.length
      ? q.or(`course_id.is.null,course_id.in.(${myCourseIds.join(",")})`)
      : q.is("course_id", null);
  }
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; title: string | null; summary: string | null; lesson_date: string;
    course_id: string | null; courses: { title: string } | { title: string }[] | null;
  };
  const lessons = ((data ?? []) as Row[]).map((d) => ({
    id: d.id,
    title: d.title ?? "제목 없음",
    summary: d.summary,
    date: d.lesson_date,
    course_id: d.course_id,
    course: (Array.isArray(d.courses) ? d.courses[0]?.title : d.courses?.title) ?? null,
  }));
  return NextResponse.json({ lessons });
}
