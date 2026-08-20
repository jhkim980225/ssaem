import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";

// 강사 목록.
// - 학생: 수강 연결(enrollments)된 강사만 — 선생님 코드/초대로 등록해야 보인다 (v0.33.0).
//   공개(is_public) 여부와 무관: 연결됐으면 비공개여도 보이고, 안 됐으면 공개여도 안 보인다.
// - 강사·원장: 내 학원의 공개 강사 전체 (미리보기·관리 용도).
export async function GET(req: Request) {
  const me = await userWithRole(req);
  if (!me)
    return NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 });
  const g = { uid: me.uid };
  const slug = new URL(req.url).searchParams.get("academy");
  const db = serviceClient();

  // 기본은 "내 학원". 예전엔 slug가 없으면 필터가 없어 전 학원 공개 강사 명단이 나왔다.
  // slug를 줘도 내 학원이 아니면 무시한다 — 남의 학원 slug로 명단을 볼 수 없게.
  const mine = await academyOf(db, g.uid);
  let academyId: string | null = mine;
  if (slug) {
    const { data } = await db.from("academies").select("id").eq("slug", slug).maybeSingle();
    if (!data || (mine && data.id !== mine)) return NextResponse.json({ teachers: [] });
    academyId = data.id;
  }
  if (!academyId) return NextResponse.json({ teachers: [] });

  // 학생은 학원 공개 명단을 아예 안 받는다 — 아래 수강 연결 병합만으로 목록을 만든다
  const isStudent = me.role === "student";
  const { data, error } = isStudent
    ? { data: [], error: null }
    : await db
        .from("profiles")
        .select("id, name, academy_id, teacher_profiles!inner(subject, is_public)")
        .eq("role", "teacher")
        .eq("teacher_profiles.is_public", true)
        .eq("academy_id", academyId)
        .order("name");
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
  const uid = g.uid;
  {
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
