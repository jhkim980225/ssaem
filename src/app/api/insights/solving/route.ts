import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { fetchAll } from "../../admin/_lib/fetch-all";
import { periodOf } from "@/lib/period";

// 강사 인사이트 — 학생 문제 풀이 기록: 누가 어떤 문제를 풀었고 맞혔는지, 많이 틀린 문제, 회차 시험 점수.
// 대상은 이 강사 강좌에 수강 연결된 학생(role=student)만. 기간은 /api/insights와 같다.
const PER_STUDENT = 60; // 학생별 최근 풀이 목록 길이
const MISSED = 10;
const CHUNK = 150; // .in() 목록이 길면 URL이 너무 길어진다

type Attempt = { id: string; user_id: string; question_id: string; is_correct: boolean; created_at: string };
type Question = { id: string; subject: string; category: string; source: string | null; seq: number | null; stem: string };

// 미리보기용 지문 — 그림 토큰([[그림]]URL#폭x높이)을 빼고 한 줄로
const preview = (stem: string) =>
  stem
    .replace(/\[\[그림\]\]\S+/g, "[그림]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

export async function GET(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;
  const db = serviceClient();
  const period = periodOf(req);
  const base = { days: period.days, from: period.from, to: period.to };

  const { data: enr } = await db
    .from("enrollments")
    .select("student_id, courses!inner(teacher_id)")
    .eq("courses.teacher_id", uid);
  const enrolled = [...new Set(((enr ?? []) as { student_id: string }[]).map((e) => e.student_id))];
  const { data: profiles } = enrolled.length
    ? await db.from("profiles").select("id, name").eq("role", "student").in("id", enrolled)
    : { data: [] };
  const nameOf = new Map(((profiles ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name || "이름 없음"]));
  const ids = [...nameOf.keys()];
  const empty = { ...base, totals: { attempts: 0, correct: 0, active: 0, students: ids.length }, students: [], missed: [], exams: [], questions: {} };
  if (!ids.length) return NextResponse.json(empty);

  const attempts: Attempt[] = [];
  const sessions: { user_id: string; subject: string; source: string | null; total: number; score: number; created_at: string }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const [a, s] = await Promise.all([
      fetchAll((from, to) =>
        db
          .from("bank_attempts")
          .select("id, user_id, question_id, is_correct, created_at")
          .in("user_id", part)
          .gte("created_at", period.sinceIso)
          .lt("created_at", period.untilIso)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to)
      ),
      db
        .from("bank_sessions")
        .select("user_id, subject, source, total, score, created_at")
        .in("user_id", part)
        .gte("created_at", period.sinceIso)
        .lt("created_at", period.untilIso)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (a.error) return NextResponse.json({ error: a.error.message }, { status: 500 });
    attempts.push(...(a.data as Attempt[]));
    sessions.push(...(s.data ?? []));
  }
  attempts.sort((x, y) => (x.created_at < y.created_at ? 1 : -1));

  // 문항 정보 (회차·번호·지문 미리보기)
  const qids = [...new Set(attempts.map((a) => a.question_id))];
  const qOf = new Map<string, Question>();
  for (let i = 0; i < qids.length; i += CHUNK) {
    const { data } = await db
      .from("bank_questions")
      .select("id, subject, category, source, seq, stem")
      .in("id", qids.slice(i, i + CHUNK));
    for (const q of (data ?? []) as Question[]) qOf.set(q.id, q);
  }

  // 학생별
  type S = { id: string; name: string; attempts: number; correct: number; lastAt: string; recent: { q: string; ok: boolean; at: string }[] };
  const byStudent = new Map<string, S>(
    ids.map((id) => [id, { id, name: nameOf.get(id)!, attempts: 0, correct: 0, lastAt: "", recent: [] }])
  );
  // 문항별 (많이 틀린 문제)
  const byQ = new Map<string, { tries: number; wrong: number; who: Set<string> }>();
  let correct = 0;
  for (const a of attempts) {
    if (!qOf.has(a.question_id)) continue; // 문항이 지워진 기록
    const s = byStudent.get(a.user_id)!;
    s.attempts++;
    if (a.is_correct) {
      s.correct++;
      correct++;
    }
    if (!s.lastAt) s.lastAt = a.created_at; // 최신순으로 돈다
    if (s.recent.length < PER_STUDENT) s.recent.push({ q: a.question_id, ok: a.is_correct, at: a.created_at });
    const e = byQ.get(a.question_id) ?? { tries: 0, wrong: 0, who: new Set<string>() };
    e.tries++;
    if (!a.is_correct) {
      e.wrong++;
      e.who.add(a.user_id);
    }
    byQ.set(a.question_id, e);
  }

  const students = [...byStudent.values()].sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name, "ko"));
  const missed = [...byQ.entries()]
    .filter(([, e]) => e.wrong > 0)
    .sort((a, b) => b[1].who.size - a[1].who.size || b[1].wrong - a[1].wrong)
    .slice(0, MISSED)
    .map(([q, e]) => ({ q, tries: e.tries, wrong: e.wrong, students: [...e.who].map((id) => nameOf.get(id)!) }));

  // 화면에 나올 문항만 내려 보낸다
  const shown = new Set<string>([...missed.map((m) => m.q), ...students.flatMap((s) => s.recent.map((r) => r.q))]);
  const questions: Record<string, { subject: string; category: string; source: string | null; seq: number | null; text: string }> = {};
  for (const id of shown) {
    const q = qOf.get(id)!;
    questions[id] = { subject: q.subject, category: q.category, source: q.source, seq: q.seq, text: preview(q.stem) };
  }

  const exams = sessions
    .sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
    .slice(0, 50)
    .map((s) => ({ name: nameOf.get(s.user_id)!, subject: s.subject, source: s.source, score: s.score, total: s.total, at: s.created_at }));

  return NextResponse.json({
    ...base,
    totals: {
      attempts: attempts.filter((a) => qOf.has(a.question_id)).length,
      correct,
      active: students.filter((s) => s.attempts > 0).length,
      students: ids.length,
    },
    students,
    missed,
    exams,
    questions,
  });
}
