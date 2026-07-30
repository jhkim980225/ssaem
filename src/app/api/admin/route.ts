import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";
import { createInviteCode } from "@/lib/invite";

// 원장 대시보드 데이터: 학원 정보, 강사 목록(자료·질문 수), 강사 초대 링크/QR.
export async function GET(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  const { data: me } = await db
    .from("profiles")
    .select("role, academy_id, name, academies(name, slug)")
    .eq("id", uid)
    .maybeSingle();
  if (!me || me.role !== "admin")
    return NextResponse.json({ error: "원장 계정이 아니에요" }, { status: 403 });

  const academy = Array.isArray(me.academies) ? me.academies[0] : me.academies;

  // 플랜 (plan 컬럼 미마이그레이션이면 free로 폴백 — 대시보드는 죽지 않게)
  let plan = "free";
  try {
    const { data: a } = await db.from("academies").select("plan").eq("id", me.academy_id).maybeSingle();
    if (a?.plan === "pro") plan = "pro";
  } catch {}

  // 우리 학원 강사들 + 자료 수
  const { data: ts } = await db
    .from("profiles")
    .select("id, name, teacher_profiles(subject, is_public), documents(count)")
    .eq("academy_id", me.academy_id)
    .eq("role", "teacher")
    .order("name");

  type Row = {
    id: string;
    name: string;
    teacher_profiles: { subject: string | null; is_public: boolean } | { subject: string | null; is_public: boolean }[] | null;
    documents: { count: number }[];
  };
  const teachers = ((ts ?? []) as Row[]).map((t) => {
    const tp = Array.isArray(t.teacher_profiles) ? t.teacher_profiles[0] : t.teacher_profiles;
    return {
      id: t.id,
      name: t.name,
      subject: tp?.subject ?? null,
      is_public: tp?.is_public ?? true,
      documents: t.documents?.[0]?.count ?? 0,
    };
  });

  // 강사별 학생 목록 (수강 연결 기준)
  const studentsByTeacher = new Map<string, { id: string; name: string }[]>();
  if (teachers.length) {
    const { data: enr } = await db
      .from("enrollments")
      .select("courses!inner(teacher_id), profiles!enrollments_student_id_fkey(id, name)")
      .in("courses.teacher_id", teachers.map((t) => t.id));
    type ERow = {
      courses: { teacher_id: string } | { teacher_id: string }[];
      profiles: { id: string; name: string } | { id: string; name: string }[] | null;
    };
    for (const e of (enr ?? []) as ERow[]) {
      const tid = Array.isArray(e.courses) ? e.courses[0]?.teacher_id : e.courses?.teacher_id;
      const st = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
      if (!tid || !st) continue;
      const arr = studentsByTeacher.get(tid) ?? [];
      if (!arr.some((s) => s.id === st.id)) arr.push(st);
      studentsByTeacher.set(tid, arr);
    }
  }
  const teachersWithStudents = teachers.map((t) => ({
    ...t,
    students: studentsByTeacher.get(t.id) ?? [],
  }));

  // 학원 학생 수 + 최근 7일 질문 수
  const [{ count: students }, { count: recentQuestions }] = await Promise.all([
    db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("academy_id", me.academy_id)
      .eq("role", "student"),
    teachers.length
      ? db
          .from("messages")
          .select("id, conversations!inner(teacher_id)", { count: "exact", head: true })
          .eq("role", "user")
          .in("conversations.teacher_id", teachers.map((t) => t.id))
          .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      : Promise.resolve({ count: 0 }),
  ]);

  // 강사 초대
  const code = createInviteCode(uid, "t");
  const origin = new URL(req.url).origin;
  const inviteUrl = `${origin}/join-teacher/${code}`;
  const qrSvg = await QRCode.toString(inviteUrl, { type: "svg", margin: 1, width: 220 });

  return NextResponse.json({
    admin: { name: me.name },
    academy: { name: academy?.name ?? "", slug: academy?.slug ?? "", plan },
    teachers: teachersWithStudents,
    stats: { teachers: teachers.length, students: students ?? 0, recentQuestions: recentQuestions ?? 0 },
    invite: { url: inviteUrl, qrSvg },
  });
}
