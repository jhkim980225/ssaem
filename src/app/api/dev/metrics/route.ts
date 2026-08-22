import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

// 개발자 지표 — /dev 대시보드 전용. dev 역할만.
// MAU/WAU/DAU는 visit_days(학생 접속 롤업) 기준 — 접속 추적 도입(v0.40.0) 이후 데이터만 잡힌다.
export async function GET(req: Request) {
  const g = await requireRole(req, "dev");
  if ("res" in g) return g.res;

  const db = serviceClient();
  const now = Date.now();
  const kstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
  const today = kstDay(now);
  const since7 = kstDay(now - 6 * 86_400_000);
  const since30 = kstDay(now - 29 * 86_400_000);
  const since30Iso = new Date(now - 30 * 86_400_000).toISOString();

  const head = { count: "exact" as const, head: true };
  const c = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;

  const [
    students,
    teachers,
    admins,
    academies,
    newUsers30,
    convsTotal,
    convs30,
    userMsgs30,
    quizAttempts30,
    bankAttempts30,
    cbtSessions30,
    documents,
    visitRows,
  ] = await Promise.all([
    c(db.from("profiles").select("*", head).eq("role", "student")),
    c(db.from("profiles").select("*", head).eq("role", "teacher")),
    c(db.from("profiles").select("*", head).eq("role", "admin")),
    c(db.from("academies").select("*", head)),
    c(db.from("profiles").select("*", head).gte("created_at", since30Iso)),
    c(db.from("conversations").select("*", head)),
    c(db.from("conversations").select("*", head).gte("created_at", since30Iso)),
    c(db.from("messages").select("*", head).eq("role", "user").gte("created_at", since30Iso)),
    c(db.from("quiz_attempts").select("*", head).gte("created_at", since30Iso)),
    c(db.from("bank_attempts").select("*", head).gte("created_at", since30Iso)),
    c(db.from("bank_sessions").select("*", head).gte("created_at", since30Iso)),
    c(db.from("documents").select("*", head)),
    db
      .from("visit_days")
      .select("student_id, day, count")
      .gte("day", since30)
      .then(({ data }) => (data ?? []) as { student_id: string; day: string; count: number }[]),
  ]);

  // 활성 사용자: 기간 내 접속한 학생 distinct
  const dau = new Set(visitRows.filter((v) => v.day === today).map((v) => v.student_id)).size;
  const wau = new Set(visitRows.filter((v) => v.day >= since7).map((v) => v.student_id)).size;
  const mau = new Set(visitRows.map((v) => v.student_id)).size;

  // 일별 시계열 (최근 30일, 빈 날 0으로 채움)
  const byDay = new Map<string, { students: Set<string>; visits: number }>();
  for (const v of visitRows) {
    const e = byDay.get(v.day) ?? { students: new Set<string>(), visits: 0 };
    e.students.add(v.student_id);
    e.visits += v.count;
    byDay.set(v.day, e);
  }
  const daily: { day: string; students: number; visits: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = kstDay(now - i * 86_400_000);
    const e = byDay.get(d);
    daily.push({ day: d, students: e?.students.size ?? 0, visits: e?.visits ?? 0 });
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    users: { students, teachers, admins, academies, newUsers30 },
    active: { dau, wau, mau },
    usage30: {
      conversations: convs30,
      questions: userMsgs30,
      quizAttempts: quizAttempts30,
      bankAttempts: bankAttempts30,
      cbtSessions: cbtSessions30,
    },
    totals: { conversations: convsTotal, documents },
    daily,
  });
}
