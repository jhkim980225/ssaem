import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { createInviteCode } from "@/lib/invite";

// 답변 1건이 아꼈다고 보는 조교 시간(분). /pricing이 조교 인건비와 비교하는 논리를
// 화면에서 이어받기 위한 환산 기준 — 근거를 화면에도 같이 표시한다.
const MINUTES_PER_ANSWER = 3;
const PERIODS = [7, 30, 90] as const;

// 원장 대시보드. 기간(7·30·90일) 단위로 학원 현황 + 이번 기간 작업량 + 학생 참여율.
export async function GET(req: Request) {
  const gate = await requireRole(req, "admin");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  const url = new URL(req.url);
  const raw = Number(url.searchParams.get("days"));
  const days = (PERIODS as readonly number[]).includes(raw) ? raw : 30;

  const db = serviceClient();
  const { data: me } = await db
    .from("profiles")
    .select("academy_id, name, academies(name, slug, plan)")
    .eq("id", uid)
    .maybeSingle();
  if (!me?.academy_id) return NextResponse.json({ error: "학원 정보가 없어요" }, { status: 404 });
  const academy = Array.isArray(me.academies) ? me.academies[0] : me.academies;

  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  // 우리 학원 강사
  const { data: ts } = await db
    .from("profiles")
    .select("id, name, teacher_profiles(subject, is_public), documents(count)")
    .eq("academy_id", me.academy_id)
    .eq("role", "teacher")
    .order("name");
  type TRow = {
    id: string;
    name: string;
    teacher_profiles: { subject: string | null; is_public: boolean } | { subject: string | null; is_public: boolean }[] | null;
    documents: { count: number }[];
  };
  const teacherRows = (ts ?? []) as TRow[];
  const teacherIds = teacherRows.map((t) => t.id);

  // 우리 학원 학생
  const { data: ss } = await db
    .from("profiles")
    .select("id, name")
    .eq("academy_id", me.academy_id)
    .eq("role", "student")
    .order("name");
  const studentRows = (ss ?? []) as { id: string; name: string }[];

  if (!teacherIds.length) {
    return NextResponse.json({
      admin: { name: me.name },
      academy: { name: academy?.name ?? "", slug: academy?.slug ?? "", plan: academy?.plan ?? "free" },
      period: { days, options: PERIODS },
      stats: { teachers: 0, students: studentRows.length, activeStudents: 0, questions: 0, up: 0, down: 0 },
      work: { newDocuments: 0, newQuestions: 0 },
      cumulative: { answers: 0, minutesPerAnswer: MINUTES_PER_ANSWER, hoursSaved: 0 },
      daily: [],
      teachers: [],
      students: studentRows.map((s) => ({ ...s, questions: 0, lastAt: null })),
      lowRated: [],
      invite: await inviteFor(uid, req),
    });
  }

  // 질문(user 메시지)만 필요한 컬럼으로 — 예전엔 assistant까지 2000건 제한으로 읽어서
  // 학원이 조금만 커져도 그래프·집계가 조용히 잘렸다.
  const [qRes, fbRes, docRes, ansRes] = await Promise.all([
    db
      .from("messages")
      .select("created_at, conversations!inner(teacher_id, student_id)")
      .eq("role", "user")
      .in("conversations.teacher_id", teacherIds)
      .gte("created_at", sinceIso)
      .limit(20_000),
    // 평가는 답변에 달리므로 message_feedback에서 바로 훑는다 (메시지 전수 스캔 불필요)
    db
      .from("message_feedback")
      .select("rating, created_at, messages!inner(conversations!inner(teacher_id))")
      .in("messages.conversations.teacher_id", teacherIds)
      .gte("created_at", sinceIso)
      .limit(20_000),
    db
      .from("documents")
      .select("id", { count: "exact", head: true })
      .in("teacher_id", teacherIds)
      .gte("created_at", sinceIso),
    // 누적 답변 수 (기간 무관) — 조교 시간 환산의 근거.
    // 조인 컬럼으로 거르려면 !inner로 임베드해야 한다 (없으면 필터가 조용히 무시된다)
    db
      .from("messages")
      .select("id, conversations!inner(teacher_id)", { count: "exact", head: true })
      .eq("role", "assistant")
      .in("conversations.teacher_id", teacherIds),
  ]);

  type QRow = { created_at: string; conversations: { teacher_id: string; student_id: string | null } | { teacher_id: string; student_id: string | null }[] };
  const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

  const byDate = new Map<string, number>();
  const byTeacher = new Map<string, number>();
  const byStudent = new Map<string, { n: number; last: string }>();
  for (const m of (qRes.data ?? []) as QRow[]) {
    const c = one(m.conversations);
    byDate.set(m.created_at.slice(0, 10), (byDate.get(m.created_at.slice(0, 10)) ?? 0) + 1);
    if (c?.teacher_id) byTeacher.set(c.teacher_id, (byTeacher.get(c.teacher_id) ?? 0) + 1);
    if (c?.student_id) {
      const cur = byStudent.get(c.student_id);
      byStudent.set(c.student_id, {
        n: (cur?.n ?? 0) + 1,
        last: !cur || m.created_at > cur.last ? m.created_at : cur.last,
      });
    }
  }

  type FRow = { rating: number; messages: { conversations: { teacher_id: string } | { teacher_id: string }[] } | { conversations: { teacher_id: string } | { teacher_id: string }[] }[] };
  const fb = new Map<string, { up: number; down: number }>();
  let up = 0;
  let down = 0;
  for (const f of (fbRes.data ?? []) as FRow[]) {
    const tid = one(one(f.messages)?.conversations)?.teacher_id;
    if (!tid) continue;
    const e = fb.get(tid) ?? { up: 0, down: 0 };
    if (f.rating >= 4) {
      e.up++;
      up++;
    } else if (f.rating <= 2) {
      e.down++;
      down++;
    }
    fb.set(tid, e);
  }

  const daily: { date: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({ date: d, count: byDate.get(d) ?? 0 });
  }

  // 아쉬움(👎) 받은 답변 원문 — 지금까지는 숫자만 보여 원장이 품질을 확인할 수 없었다
  const { data: lowRows } = await db
    .from("message_feedback")
    .select("rating, created_at, messages!inner(content, conversation_id, conversations!inner(teacher_id, title))")
    .lte("rating", 2)
    .in("messages.conversations.teacher_id", teacherIds)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(10);
  type LRow = {
    created_at: string;
    messages: { content: string; conversations: { teacher_id: string; title: string | null } | { teacher_id: string; title: string | null }[] } | { content: string; conversations: { teacher_id: string; title: string | null } | { teacher_id: string; title: string | null }[] }[];
  };
  const nameOf = new Map(teacherRows.map((t) => [t.id, t.name]));
  const lowRated = ((lowRows ?? []) as LRow[]).map((r) => {
    const m = one(r.messages)!;
    const c = one(m.conversations);
    return {
      question: c?.title ?? "",
      answer: m.content.slice(0, 200),
      teacher: nameOf.get(c?.teacher_id ?? "") ?? "",
      created_at: r.created_at,
    };
  });

  const teachers = teacherRows.map((t) => {
    const tp = one(t.teacher_profiles);
    return {
      id: t.id,
      name: t.name,
      subject: tp?.subject ?? null,
      is_public: tp?.is_public ?? true,
      documents: t.documents?.[0]?.count ?? 0,
      questions: byTeacher.get(t.id) ?? 0,
      up: fb.get(t.id)?.up ?? 0,
      down: fb.get(t.id)?.down ?? 0,
    };
  });

  // 학생 참여율 — "학생 N명"만 보여주면 그중 몇 명이 실제로 쓰는지 알 수 없다.
  // 안 쓰는 학생이 곧 해지 신호다.
  const students = studentRows
    .map((s) => ({
      id: s.id,
      name: s.name,
      questions: byStudent.get(s.id)?.n ?? 0,
      lastAt: byStudent.get(s.id)?.last ?? null,
    }))
    .sort((a, b) => b.questions - a.questions);
  const activeStudents = students.filter((s) => s.questions > 0).length;

  const questions = (qRes.data ?? []).length;
  const answersTotal = ansRes.count ?? 0;

  return NextResponse.json({
    admin: { name: me.name },
    academy: { name: academy?.name ?? "", slug: academy?.slug ?? "", plan: academy?.plan ?? "free" },
    period: { days, options: PERIODS },
    stats: { teachers: teachers.length, students: students.length, activeStudents, questions, up, down },
    // 이번 기간에 "우리가 한 일" — 재계약 논리. 질문 수는 학생이 만든 값이라 우리 기여를 증명 못 한다.
    work: { newDocuments: docRes.count ?? 0, newQuestions: questions },
    cumulative: {
      answers: answersTotal,
      minutesPerAnswer: MINUTES_PER_ANSWER,
      hoursSaved: Math.round((answersTotal * MINUTES_PER_ANSWER) / 60),
    },
    daily,
    teachers,
    students,
    lowRated,
    invite: await inviteFor(uid, req),
  });
}

async function inviteFor(uid: string, req: Request) {
  const code = createInviteCode(uid, "t");
  const url = `${new URL(req.url).origin}/join-teacher/${code}`;
  return { url, qrSvg: await QRCode.toString(url, { type: "svg", margin: 1, width: 220 }) };
}

// 강사 공개/비공개 토글 — 원장 전용, 같은 학원 강사만
export async function PATCH(req: Request) {
  const gate = await requireRole(req, "admin");
  if ("res" in gate) return gate.res;
  const db = serviceClient();

  const { data: me } = await db.from("profiles").select("academy_id").eq("id", gate.uid).maybeSingle();
  if (!me?.academy_id) return NextResponse.json({ error: "학원 정보가 없어요" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const teacherId = (body?.teacherId ?? "").toString();
  if (!/^[0-9a-f-]{36}$/i.test(teacherId))
    return NextResponse.json({ error: "teacherId required" }, { status: 400 });

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
