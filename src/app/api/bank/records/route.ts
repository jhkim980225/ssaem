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

  const db = serviceClient();
  const { data: sess, error } = await db
    .from("bank_sessions")
    .insert({ user_id: g.uid, subject, source, total, score })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 이 세션에서 푼 문항들을 세션에 연결 — "이 회차에서 뭘 틀렸나" 상세용.
  // 한 문제씩 모드는 문항을 풀 때마다 attempt를 따로 남기므로, 완주 시점에 묶어 준다.
  // 아직 어느 세션에도 안 묶인 마지막 시도만 대상 (다시 푼 문항이 과거 세션을 덮지 않게).
  const questionIds = (Array.isArray(body?.questionIds) ? body.questionIds : [])
    .map((v: unknown) => (v ?? "").toString())
    .filter((v: string) => /^[0-9a-f-]{36}$/i.test(v))
    .slice(0, 50);
  if (sess?.id && questionIds.length) {
    const { data: pending } = await db
      .from("bank_attempts")
      .select("id, question_id, created_at")
      .eq("user_id", g.uid)
      .is("session_id", null)
      .in("question_id", questionIds)
      .order("created_at", { ascending: false });
    // 같은 문항을 여러 번 시도했으면 가장 최근 것 하나만 이 세션에 속한다
    const latest = new Map<string, string>();
    for (const a of pending ?? []) if (!latest.has(a.question_id)) latest.set(a.question_id, a.id);
    if (latest.size) {
      const { error: lerr } = await db
        .from("bank_attempts")
        .update({ session_id: sess.id })
        .in("id", [...latest.values()]);
      // 연결 실패해도 점수 기록은 유효하다 — 상세만 비어 보인다
      if (lerr) console.error("bank session link:", lerr.message);
    }
  }
  return NextResponse.json({ ok: true, sessionId: sess?.id ?? null });
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
    .select("id, user_id, subject, source, total, score, created_at")
    .in("user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 어느 기록에 문항 상세가 있는지 미리 알려준다 — 없는 카드에 헛클릭하게 두지 않으려고.
  // (백필 전 옛 기록·연결 실패분은 상세가 비어 있다)
  const ids = (data ?? []).map((r) => r.id);
  const detailed = new Set<string>();
  if (ids.length) {
    const { data: linked } = await db
      .from("bank_attempts")
      .select("session_id")
      .in("session_id", ids);
    for (const a of linked ?? []) if (a.session_id) detailed.add(a.session_id);
  }

  const records = (data ?? []).map((r) => ({
    id: r.id,
    name: name ? names.get(r.user_id) ?? "" : undefined,
    subject: r.subject,
    source: r.source,
    total: r.total,
    score: r.score,
    at: r.created_at,
    hasDetail: detailed.has(r.id),
  }));
  return NextResponse.json({ records });
}
