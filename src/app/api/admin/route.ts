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
  // 학원 학생 수 + 학원 단위 인사이트(14일 메시지 — 일별 추이·강사별 평가를 JS 집계)
  const DAYS = 14;
  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const [{ count: students }, { data: msgs }] = await Promise.all([
    db
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("academy_id", me.academy_id)
      .eq("role", "student"),
    teachers.length
      ? db
          .from("messages")
          .select("role, created_at, conversations!inner(teacher_id), message_feedback(rating)")
          .in("conversations.teacher_id", teachers.map((t) => t.id))
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: true })
          .limit(2000)
      : Promise.resolve({ data: [] }),
  ]);

  type MRow = {
    role: string;
    created_at: string;
    conversations: { teacher_id: string } | { teacher_id: string }[];
    message_feedback: { rating: number } | { rating: number }[] | null;
  };
  const byDate = new Map<string, number>();
  const fb = new Map<string, { up: number; down: number }>();
  let recentQuestions = 0;
  const weekAgo = Date.now() - 7 * 86_400_000;
  for (const m of (msgs ?? []) as MRow[]) {
    const tid = Array.isArray(m.conversations) ? m.conversations[0]?.teacher_id : m.conversations?.teacher_id;
    if (m.role === "user") {
      const d = m.created_at.slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
      if (new Date(m.created_at).getTime() >= weekAgo) recentQuestions++;
      continue;
    }
    const f = m.message_feedback;
    const rating = Array.isArray(f) ? f[0]?.rating ?? null : f?.rating ?? null;
    if (rating === null || !tid) continue;
    const e = fb.get(tid) ?? { up: 0, down: 0 };
    if (rating >= 4) e.up++;
    else if (rating <= 2) e.down++;
    fb.set(tid, e);
  }
  const daily: { date: string; count: number }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({ date: d, count: byDate.get(d) ?? 0 });
  }

  const teachersWithStudents = teachers.map((t) => ({
    ...t,
    students: studentsByTeacher.get(t.id) ?? [],
    up: fb.get(t.id)?.up ?? 0,
    down: fb.get(t.id)?.down ?? 0,
  }));

  // 강사 초대
  const code = createInviteCode(uid, "t");
  const origin = new URL(req.url).origin;
  const inviteUrl = `${origin}/join-teacher/${code}`;
  const qrSvg = await QRCode.toString(inviteUrl, { type: "svg", margin: 1, width: 220 });

  return NextResponse.json({
    admin: { name: me.name },
    academy: { name: academy?.name ?? "", slug: academy?.slug ?? "", plan },
    teachers: teachersWithStudents,
    stats: { teachers: teachers.length, students: students ?? 0, recentQuestions },
    insights: { days: DAYS, daily },
    invite: { url: inviteUrl, qrSvg },
  });
}

// 강사 공개/비공개 토글 — 원장 전용, 같은 학원 강사만
export async function PATCH(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();

  const { data: me } = await db.from("profiles").select("role, academy_id").eq("id", uid).maybeSingle();
  if (!me || me.role !== "admin")
    return NextResponse.json({ error: "원장 계정이 아니에요" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const teacherId = (body?.teacherId ?? "").toString();
  if (!teacherId) return NextResponse.json({ error: "teacherId required" }, { status: 400 });

  const { data: t } = await db
    .from("profiles")
    .select("id, teacher_profiles(is_public)")
    .eq("id", teacherId)
    .eq("academy_id", me.academy_id)
    .eq("role", "teacher")
    .maybeSingle();
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });

  const tp = Array.isArray(t.teacher_profiles) ? t.teacher_profiles[0] : t.teacher_profiles;
  const next = !(tp?.is_public ?? true);
  const { error } = await db.from("teacher_profiles").update({ is_public: next }).eq("id", teacherId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, is_public: next });
}
