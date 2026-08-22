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

  // 가입 통계 — 일별 신규(30일)와 학원별 인원 분포
  const { data: allProfiles } = await db
    .from("profiles")
    .select("role, created_at, academy_id, academies(name)")
    .limit(10000);
  type PRow = {
    role: string;
    created_at: string;
    academy_id: string | null;
    academies: { name: string } | { name: string }[] | null;
  };
  const signupByDay = new Map<string, number>();
  const byAcademy = new Map<string, { name: string; students: number; teachers: number; admins: number }>();
  for (const p of (allProfiles ?? []) as PRow[]) {
    if (p.role === "dev") continue;
    const d = kstDay(Date.parse(p.created_at));
    if (d >= since30) signupByDay.set(d, (signupByDay.get(d) ?? 0) + 1);
    const key = p.academy_id ?? "none";
    const ac = Array.isArray(p.academies) ? p.academies[0] : p.academies;
    const e = byAcademy.get(key) ?? { name: ac?.name ?? "미소속", students: 0, teachers: 0, admins: 0 };
    if (p.role === "student") e.students++;
    else if (p.role === "teacher") e.teachers++;
    else if (p.role === "admin") e.admins++;
    byAcademy.set(key, e);
  }
  const signupDaily: { day: string; count: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = kstDay(now - i * 86_400_000);
    signupDaily.push({ day: d, count: signupByDay.get(d) ?? 0 });
  }
  const academyRows = [...byAcademy.values()]
    .map((a) => ({ ...a, total: a.students + a.teachers + a.admins }))
    .sort((a, b) => b.total - a.total);

  // 사용자별 접속 집계 (전 기간) — 학생 전원 + 접속 0인 학생도 포함해 비활성까지 보이게
  const [allVisits, studentProfiles] = await Promise.all([
    db
      .from("visit_days")
      .select("student_id, day, count, last_at")
      .order("day", { ascending: false })
      .limit(20000)
      .then(({ data }) => (data ?? []) as { student_id: string; day: string; count: number; last_at: string }[]),
    db
      .from("profiles")
      .select("id, name, academies(name)")
      .eq("role", "student")
      .then(
        ({ data }) =>
          (data ?? []) as { id: string; name: string; academies: { name: string } | { name: string }[] | null }[]
      ),
  ]);
  const perUser = new Map<string, { visits: number; days: string[]; lastAt: string }>();
  for (const v of allVisits) {
    const e = perUser.get(v.student_id) ?? { visits: 0, days: [], lastAt: "" };
    e.visits += v.count;
    e.days.push(v.day);
    if (v.last_at > e.lastAt) e.lastAt = v.last_at;
    perUser.set(v.student_id, e);
  }
  const todayStr = kstDay(now);
  const streakOf = (days: string[]) => {
    const have = new Set(days);
    let anchor = Date.parse(todayStr);
    if (!have.has(todayStr)) anchor -= 86_400_000;
    let n = 0;
    while (have.has(new Date(anchor).toISOString().slice(0, 10))) {
      n++;
      anchor -= 86_400_000;
    }
    return n;
  };
  const perUserRows = studentProfiles
    .map((p) => {
      const e = perUser.get(p.id);
      const ac = Array.isArray(p.academies) ? p.academies[0] : p.academies;
      return {
        id: p.id,
        name: p.name,
        academy: ac?.name ?? null,
        visits: e?.visits ?? 0,
        visitDays: e?.days.length ?? 0,
        streak: e ? streakOf(e.days) : 0,
        lastVisit: e?.lastAt ?? null,
      };
    })
    .sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));

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
    signupDaily,
    academies: academyRows,
    perUser: perUserRows,
  });
}
