import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 시험 기록 상세 — "이 회차에서 뭘 틀렸나".
// GET /api/bank/records/<sessionId> → 세션 메타 + 문항별 (내 답 / 정답 / 해설)
// 본인 기록만. 이미 응시가 끝난 회차라 정답·해설을 함께 내려도 무방하다(오답노트와 같은 규약).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankrec:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = serviceClient();
  const { data: s } = await db
    .from("bank_sessions")
    .select("id, user_id, subject, source, total, score, created_at")
    .eq("id", id)
    .maybeSingle();
  // 남의 기록은 없는 것과 같이 다룬다 (존재 여부도 알려주지 않는다)
  if (!s || s.user_id !== g.uid) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: attempts } = await db
    .from("bank_attempts")
    .select("question_id, chosen_idx, is_correct, created_at")
    .eq("session_id", id)
    .order("created_at");

  const session = {
    id: s.id,
    subject: s.subject,
    source: s.source,
    total: s.total,
    score: s.score,
    at: s.created_at,
  };
  if (!attempts?.length) return NextResponse.json({ session, items: [] });

  const { data: qs } = await db
    .from("bank_questions")
    .select("id, subject, category, type_tag, stem, choices, answer_idx, answer_text, explanation, images")
    .in(
      "id",
      attempts.map((a) => a.question_id)
    );
  const byId = new Map((qs ?? []).map((q) => [q.id, q]));

  const items = attempts
    .map((a) => {
      const q = byId.get(a.question_id);
      if (!q) return null; // 문항이 지워진 경우 — 상세에서 조용히 뺀다
      return {
        id: q.id,
        subject: q.subject,
        category: q.category,
        typeTag: q.type_tag,
        stem: q.stem,
        choices: q.choices,
        answerIdx: q.answer_idx,
        answerText: q.answer_text,
        explanation: q.explanation,
        images: q.images ?? null,
        chosen: a.chosen_idx,
        correct: a.is_correct,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ session, items });
}
