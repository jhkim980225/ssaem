import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";

// 수업 상세 (달력 카드 → 별도 페이지). 목록 API(/api/lessons)와 같은 노출 규칙:
// 요약·제목만 — 원문(raw_text)은 RAG 근거용이라 내려보내지 않는다.
// 강사는 본인 자료만, 학생은 같은 학원 + (공용 또는 수강 ROOM 수업)만.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = serviceClient();
  const { data: d } = await db
    .from("documents")
    .select("id, title, summary, lesson_date, course_id, teacher_id, courses(title)")
    .eq("id", id)
    .not("lesson_date", "is", null)
    .maybeSingle();
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 목록(/api/lessons)과 **같은 규칙**으로 판단한다. 목록에 떠서 눌렀는데 상세가 404면
  // 그냥 막다른 길이다 — 실제로 학원장·다른 강사가 /ask 달력에서 그 상태였다.
  // 상세가 목록보다 더 주는 정보도 없다(제목·요약은 목록에도 있다).
  if (!(await sameAcademy(db, me.uid, d.teacher_id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  // 학생만 ROOM 제한 — 수강 연결된 강좌이거나 공용(course_id null)이어야 한다
  if (me.role !== "teacher" && me.role !== "admin" && d.course_id) {
    const { data: enr } = await db
      .from("enrollments")
      .select("id")
      .eq("student_id", me.uid)
      .eq("course_id", d.course_id)
      .maybeSingle();
    if (!enr) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: t } = await db.from("profiles").select("name").eq("id", d.teacher_id).maybeSingle();
  const courses = d.courses as { title: string } | { title: string }[] | null;
  return NextResponse.json({
    lesson: {
      id: d.id,
      title: d.title ?? "제목 없음",
      summary: d.summary,
      date: d.lesson_date,
      course: (Array.isArray(courses) ? courses[0]?.title : courses?.title) ?? null,
      teacherName: t?.name ?? null,
    },
  });
}
