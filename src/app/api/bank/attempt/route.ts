import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 문제은행 채점·기록.
// POST 이론:  { questionId, chosen: 0~3 } → 서버 채점, { correct, answer_idx, explanation } 반환
// POST 실무:  { questionId, correct: bool } → 자가채점 결과만 기록 (답은 목록에서 이미 받음)
// GET:       오답노트 (본인 마지막 시도 오답 + 문항)
//
// rate limit 키는 기존 attempt(quiz)와 분리 — 서로 한도를 잡아먹지 않게.

export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankattempt:${clientIp(req)}`, 120, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const questionId = (body?.questionId ?? "").toString();
  if (!/^[0-9a-f-]{36}$/i.test(questionId))
    return NextResponse.json({ error: "questionId required" }, { status: 400 });

  const db = serviceClient();
  const { data: q } = await db
    .from("bank_questions")
    .select("id, choices, answer_idx, answer_text, explanation")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });

  const isTheory = Array.isArray(q.choices) && q.choices.length > 0 && q.answer_idx !== null;

  let chosenIdx: number | null = null;
  let correct: boolean;

  if (isTheory) {
    const chosen = Number(body?.chosen);
    if (!Number.isInteger(chosen) || chosen < 0 || chosen > 3)
      return NextResponse.json({ error: "chosen(0~3) required" }, { status: 400 });
    chosenIdx = chosen;
    correct = chosen === q.answer_idx;
  } else {
    // 실무 자가채점 — 학생이 스스로 맞음/틀림을 표시
    if (typeof body?.correct !== "boolean")
      return NextResponse.json({ error: "correct(bool) required" }, { status: 400 });
    correct = body.correct;
  }

  const { error } = await db
    .from("bank_attempts")
    .insert({ question_id: q.id, user_id: g.uid, chosen_idx: chosenIdx, is_correct: correct });
  if (error) console.error("bank attempt insert:", error.message);

  // 이론만 정답·해설을 돌려준다 (실무는 이미 목록에서 받았다)
  return NextResponse.json(
    isTheory
      ? { ok: true, correct, answer_idx: q.answer_idx, explanation: q.explanation ?? "", saved: !error }
      : { ok: true, correct, saved: !error }
  );
}

// 오답노트 — 본인 마지막 시도가 오답인 문항. 이론은 정답 포함(이미 시도했으므로 노출 무방).
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;

  const db = serviceClient();
  // 총계 + 마지막 시도
  const { data: attempts } = await db
    .from("bank_attempts")
    .select("question_id, chosen_idx, is_correct, created_at")
    .eq("user_id", g.uid)
    .order("created_at", { ascending: false })
    .limit(2000);
  type A = { question_id: string; chosen_idx: number | null; is_correct: boolean; created_at: string };
  // 최신순 + 문항별 첫 등장만 = 마지막 시도 (2000건 초과 시 최신 기준 유지)
  const last = new Map<string, A>();
  for (const a of (attempts ?? []) as A[]) if (!last.has(a.question_id)) last.set(a.question_id, a);
  const wrong = [...last.values()].filter((a) => !a.is_correct);
  const totals = { attempted: last.size, wrong: wrong.length, correct: last.size - wrong.length };
  if (!wrong.length) return NextResponse.json({ totals, notes: [] });

  const { data: qs } = await db
    .from("bank_questions")
    .select("id, subject, category, type_tag, stem, choices, answer_idx, answer_text, explanation")
    .in(
      "id",
      wrong.map((w) => w.question_id)
    );
  const byId = new Map((qs ?? []).map((q) => [q.id, q]));

  const notes = wrong
    .map((w) => {
      const q = byId.get(w.question_id);
      if (!q) return null;
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
        chosen: w.chosen_idx,
        at: w.created_at,
      };
    })
    .filter(Boolean)
    .reverse();

  return NextResponse.json({ totals, notes });
}
