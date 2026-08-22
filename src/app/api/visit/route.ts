import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole, requireRole } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 학생 접속(출석) 기록.
// POST — 앱을 열 때 클라이언트가 세션당 1번 핑. (학생, 오늘) 행의 count를 올린다.
//        학생이 아니면 조용히 무시 — 강사·원장 접속은 출석이 아니다.
// GET  — 내 출석 요약: 총 방문·출석일수·연속 출석(오늘 또는 어제까지 이어진 날 수).

// KST 기준 날짜 — 학원은 한국에서만 쓴다. UTC로 자르면 오전 9시 전 접속이 어제로 붙는다.
function todayKST(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!rateLimit(`visit:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  if (me.role !== "student") return NextResponse.json({ ok: true, counted: false });

  const db = serviceClient();
  const day = todayKST();
  // 읽고-올려쓰기 — 동시 접속 경합으로 1~2회 덜 세져도 출석 표시엔 지장 없다
  const { data: cur } = await db
    .from("visit_days")
    .select("count")
    .eq("student_id", me.uid)
    .eq("day", day)
    .maybeSingle();
  const { error } = await db.from("visit_days").upsert(
    { student_id: me.uid, day, count: (cur?.count ?? 0) + 1, last_at: new Date().toISOString() },
    { onConflict: "student_id,day" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, counted: true });
}

export async function GET(req: Request) {
  const g = await requireRole(req, "student");
  if ("res" in g) return g.res;

  const db = serviceClient();
  const { data } = await db
    .from("visit_days")
    .select("day, count")
    .eq("student_id", g.uid)
    .order("day", { ascending: false })
    .limit(400);

  const rows = (data ?? []) as { day: string; count: number }[];
  const total = rows.reduce((s, r) => s + r.count, 0);
  const days = rows.length;

  // 연속 출석: 오늘(또는 아직 오늘 접속 전이면 어제)부터 하루씩 거슬러 이어진 날 수
  const have = new Set(rows.map((r) => r.day));
  const MS = 86_400_000;
  let anchor = Date.parse(todayKST());
  if (!have.has(todayKST())) anchor -= MS;
  let streak = 0;
  while (have.has(new Date(anchor).toISOString().slice(0, 10))) {
    streak++;
    anchor -= MS;
  }

  return NextResponse.json({ total, days, streak, today: have.has(todayKST()) });
}
