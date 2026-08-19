import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 시험 기록.
// GET            → 내 기록 (마이페이지)
// GET ?name=김학생 → 같은 학원 사용자의 기록을 이름으로 검색 (학원 공용 PC에서 확인용)
// POST {subject, source?, total, score} → 세션 기록 저장
//   (CBT는 배치 채점이 서버에서 직접 기록하지만, "한 문제씩" 모드는 문항별 채점이라
//    완주 시점에 클라이언트가 이 API로 세션을 남긴다)
export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankrec:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const subject = (body?.subject ?? "").toString().trim().slice(0, 40);
  const source = (body?.source ?? "").toString().slice(0, 60) || null;
  const total = Number(body?.total);
  const score = Number(body?.score);
  if (!subject || !Number.isInteger(total) || total < 1 || total > 50)
    return NextResponse.json({ error: "subject, total(1~50) required" }, { status: 400 });
  if (!Number.isInteger(score) || score < 0 || score > total)
    return NextResponse.json({ error: "score(0~total) required" }, { status: 400 });

  const { error } = await serviceClient()
    .from("bank_sessions")
    .insert({ user_id: g.uid, subject, source, total, score });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

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
