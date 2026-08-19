import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// CBT 시험 기록 조회.
// GET            → 내 기록 (마이페이지)
// GET ?name=김학생 → 같은 학원 사용자의 기록을 이름으로 검색 (학원 공용 PC에서 확인용)
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankrec:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const db = serviceClient();
  const name = (new URL(req.url).searchParams.get("name") ?? "").trim().slice(0, 30);

  let userIds: string[];
  let names = new Map<string, string>();
  if (name) {
    // 이름 검색은 테넌트 경계 안에서만 — 다른 학원 학생 성적이 보이면 안 된다
    const academy = await academyOf(db, g.uid);
    if (!academy) return NextResponse.json({ records: [] });
    const { data: users } = await db
      .from("profiles")
      .select("id, name")
      .eq("academy_id", academy)
      .ilike("name", `%${name}%`)
      .limit(20);
    userIds = (users ?? []).map((u) => u.id);
    names = new Map((users ?? []).map((u) => [u.id, u.name ?? ""]));
    if (!userIds.length) return NextResponse.json({ records: [] });
  } else {
    userIds = [g.uid];
  }

  const { data, error } = await db
    .from("bank_sessions")
    .select("user_id, subject, source, total, score, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const records = (data ?? []).map((r) => ({
    name: name ? names.get(r.user_id) ?? "" : undefined,
    subject: r.subject,
    source: r.source,
    total: r.total,
    score: r.score,
    at: r.created_at,
  }));
  return NextResponse.json({ records });
}
