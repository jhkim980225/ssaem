import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

const DAYS = 14;

// 학생별 리포트 (강사용): 최근 14일 학생별 질문 수·아쉬움 수·마지막 질문.
// 익명 대화(student_id NULL)는 집계 제외 — 학생 리포트 목적이므로.
export async function GET(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  const db = serviceClient();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("messages")
    .select(
      "role, content, created_at, conversations!inner(teacher_id, student_id), message_feedback(rating)"
    )
    .eq("conversations.teacher_id", uid)
    .not("conversations.student_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    role: string;
    content: string;
    created_at: string;
    conversations: { student_id: string } | { student_id: string }[];
    message_feedback: { rating: number } | { rating: number }[] | null;
  };
  const agg = new Map<
    string,
    { questions: number; down: number; lastQuestion: string; lastAt: string }
  >();
  for (const m of (data ?? []) as Row[]) {
    const c = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations;
    const sid = c?.student_id;
    if (!sid) continue;
    const e = agg.get(sid) ?? { questions: 0, down: 0, lastQuestion: "", lastAt: "" };
    if (m.role === "user") {
      e.questions++;
      e.lastQuestion = m.content.slice(0, 60);
      e.lastAt = m.created_at;
    } else {
      const f = m.message_feedback;
      const rating = Array.isArray(f) ? f[0]?.rating ?? null : f?.rating ?? null;
      if (rating !== null && rating <= 2) e.down++;
    }
    agg.set(sid, e);
  }

  // 목록의 기준은 수강 연결된 학생 전원 — 질문이 없어도 접속(출석) 현황은 보여야 한다
  const { data: enr } = await db
    .from("enrollments")
    .select("student_id, courses!inner(teacher_id)")
    .eq("courses.teacher_id", uid);
  type ERow = { student_id: string };
  const ids = [...new Set([...((enr ?? []) as ERow[]).map((e) => e.student_id), ...agg.keys()])];
  if (ids.length === 0) return NextResponse.json({ days: DAYS, students: [] });

  // role=student만 — 강사 자가 테스트 대화가 학생으로 잡히는 것 방지
  const { data: profiles } = await db
    .from("profiles")
    .select("id, name")
    .eq("role", "student")
    .in("id", ids);
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  // 접속(출석) 누적 — 일별 롤업을 학생별로 합산
  const { data: vd } = await db
    .from("visit_days")
    .select("student_id, day, count, last_at")
    .in("student_id", ids)
    .limit(10000);
  const visitOf = new Map<string, { visits: number; visitDays: number; lastVisit: string }>();
  for (const v of (vd ?? []) as { student_id: string; day: string; count: number; last_at: string }[]) {
    const e = visitOf.get(v.student_id) ?? { visits: 0, visitDays: 0, lastVisit: "" };
    e.visits += v.count;
    e.visitDays++;
    if (v.last_at > e.lastVisit) e.lastVisit = v.last_at;
    visitOf.set(v.student_id, e);
  }

  const students = ids
    .filter((id) => nameOf.has(id))
    .map((id) => {
      const e = agg.get(id) ?? { questions: 0, down: 0, lastQuestion: "", lastAt: "" };
      const v = visitOf.get(id) ?? { visits: 0, visitDays: 0, lastVisit: "" };
      return { id, name: nameOf.get(id)!, ...e, ...v };
    })
    .sort((a, b) => b.questions - a.questions || b.visits - a.visits);

  return NextResponse.json({ days: DAYS, students });
}
