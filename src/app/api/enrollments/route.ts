import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

// 학생 본인 수강(ROOM) 관리. 강사용 강좌 관리는 /api/courses.
// GET              → 내 수강 목록 (강좌·선생님 이름)
// DELETE ?course=  → 수강 해지 — enrollments 연결만 끊는다. 대화·응시·오답 기록은 그대로 두고,
//                    그 ROOM 코드(기본반은 선생님 코드)를 다시 입력하면 복구된다.
export async function GET(req: Request) {
  const g = await requireRole(req, "student");
  if ("res" in g) return g.res;

  const db = serviceClient();
  const { data, error } = await db
    .from("enrollments")
    .select("course_id, created_at, courses!inner(title, teacher_id, teacher:profiles(name))")
    .eq("student_id", g.uid)
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type One<T> = T | T[] | null;
  const one = <T>(v: One<T>) => (Array.isArray(v) ? v[0] ?? null : v);
  type Row = {
    course_id: string;
    created_at: string;
    courses: One<{ title: string; teacher_id: string; teacher: One<{ name: string }> }>;
  };
  const enrollments = ((data ?? []) as Row[]).map((e) => {
    const c = one(e.courses);
    return {
      course_id: e.course_id,
      title: c?.title ?? "",
      teacher_id: c?.teacher_id ?? null,
      teacher_name: one(c?.teacher ?? null)?.name ?? null,
      joined_at: e.created_at,
    };
  });
  return NextResponse.json({ enrollments });
}

export async function DELETE(req: Request) {
  const g = await requireRole(req, "student");
  if ("res" in g) return g.res;
  const course = new URL(req.url).searchParams.get("course");
  if (!course || !/^[0-9a-f-]{36}$/i.test(course))
    return NextResponse.json({ error: "course required" }, { status: 400 });

  const db = serviceClient();
  const { data, error } = await db
    .from("enrollments")
    .delete()
    .eq("course_id", course)
    .eq("student_id", g.uid)
    .select("course_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
