import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest, requireUser } from "@/lib/auth";

// 강사 목록. 기본은 공개(is_public) 강사만, ?academy=<slug>로 학원 한정.
// 로그인 학생이 Bearer로 호출하면 수강 연결(enrollments)된 비공개 강사도 포함 — 초대 기반 권한.
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const slug = new URL(req.url).searchParams.get("academy");
  const db = serviceClient();

  let academyId: string | null = null;
  if (slug) {
    const { data } = await db.from("academies").select("id").eq("slug", slug).maybeSingle();
    if (!data) return NextResponse.json({ teachers: [] });
    academyId = data.id;
  }

  let q = db
    .from("profiles")
    .select("id, name, academy_id, teacher_profiles!inner(subject, is_public)")
    .eq("role", "teacher")
    .eq("teacher_profiles.is_public", true)
    .order("name");
  if (academyId) q = q.eq("academy_id", academyId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    name: string;
    teacher_profiles: { subject: string | null }[] | { subject: string | null };
  };
  const subjectOf = (t: Row) =>
    Array.isArray(t.teacher_profiles)
      ? t.teacher_profiles[0]?.subject ?? null
      : t.teacher_profiles?.subject ?? null;

  const teachers = ((data ?? []) as Row[]).map((t) => ({
    id: t.id,
    name: t.name,
    subject: subjectOf(t),
    enrolled: false,
  }));

  // 초대(수강 연결)된 강사 병합 — 비공개여도 학생에겐 보임
  const uid = await userFromRequest(req);
  if (uid) {
    const { data: enr } = await db
      .from("enrollments")
      .select("courses!inner(teacher_id)")
      .eq("student_id", uid);
    type ERow = { courses: { teacher_id: string } | { teacher_id: string }[] };
    const teacherIds = [
      ...new Set(
        ((enr ?? []) as ERow[]).map((e) =>
          Array.isArray(e.courses) ? e.courses[0]?.teacher_id : e.courses?.teacher_id
        )
      ),
    ].filter(Boolean) as string[];

    for (const t of teachers) if (teacherIds.includes(t.id)) t.enrolled = true;
    const missing = teacherIds.filter((id) => !teachers.some((t) => t.id === id));
    if (missing.length) {
      const { data: extra } = await db
        .from("profiles")
        .select("id, name, teacher_profiles(subject)")
        .in("id", missing)
        .eq("role", "teacher");
      for (const t of (extra ?? []) as Row[])
        teachers.push({ id: t.id, name: t.name, subject: subjectOf(t), enrolled: true });
    }
    // 내 선생님 먼저
    teachers.sort((a, b) => Number(b.enrolled) - Number(a.enrolled));
  }

  // 강사 카드 메타: 자료 수·대화 수 (숨고/김과외 프로필 카드 패턴 — 데이터량 = 품질 신호)
  // 강사별 자료·대화 수. 전 행을 받아 JS로 세면 데이터가 늘수록 그대로 커지므로
  // head+count로 개수만 받는다 (강사 수만큼 쿼리지만 학원 규모에선 한 자릿수).
  const ids = teachers.map((t) => t.id);
  const meta = new Map<string, { docs: number; convs: number }>();
  if (ids.length) {
    const counted = await Promise.all(
      ids.map(async (id) => {
        const [{ count: docs }, { count: convs }] = await Promise.all([
          db.from("documents").select("id", { count: "exact", head: true }).eq("teacher_id", id),
          db.from("conversations").select("id", { count: "exact", head: true }).eq("teacher_id", id),
        ]);
        return { id, docs: docs ?? 0, convs: convs ?? 0 };
      })
    );
    for (const c of counted) meta.set(c.id, { docs: c.docs, convs: c.convs });
  }
  const withMeta = teachers.map((t) => ({
    ...t,
    docs: meta.get(t.id)?.docs ?? 0,
    convs: meta.get(t.id)?.convs ?? 0,
  }));

  return NextResponse.json({ teachers: withMeta });
}
