import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 문제은행 채점·기록.
// POST 이론:  { questionId, chosen: 0~3 } → 서버 채점, { correct, answer_idx, explanation } 반환
//             { questionId, giveUp: true } → 몰라요(오답 기록) + 정답·해설 반환
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

  // ── 배치 채점 (CBT 모드): { answers: [{questionId, chosen}] } 한 번에.
  // 15문항을 15번 호출하면 느리고 rate limit도 잡아먹는다.
  if (Array.isArray(body?.answers)) return gradeBatch(serviceClient(), g.uid, body.answers);

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
    if (body?.giveUp === true) {
      // "몰라요, 못 풀겠어요" — 오답으로 기록(오답노트에 남게)하고 정답·해설을 보여준다
      chosenIdx = null;
      correct = false;
    } else {
      const chosen = Number(body?.chosen);
      if (!Number.isInteger(chosen) || chosen < 0 || chosen > 3)
        return NextResponse.json({ error: "chosen(0~3) required" }, { status: 400 });
      chosenIdx = chosen;
      correct = chosen === q.answer_idx;
    }
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

/**
 * 이론 문항 일괄 채점. 정답은 **서버 DB 값만** 쓴다.
 * 미응답(chosen 없음)은 오답으로 기록하지 않고 건너뛴다 — 시도하지 않은 문제까지
 * 오답노트에 넣으면 "틀린 문제"의 의미가 흐려진다.
 */
async function gradeBatch(
  db: ReturnType<typeof serviceClient>,
  uid: string,
  answers: unknown[]
) {
  const picked = new Map<string, number>();
  for (const a of answers) {
    const o = a as { questionId?: unknown; chosen?: unknown };
    const id = (o?.questionId ?? "").toString();
    const n = Number(o?.chosen);
    if (/^[0-9a-f-]{36}$/i.test(id) && Number.isInteger(n) && n >= 0 && n <= 3) picked.set(id, n);
  }
  if (!picked.size) return NextResponse.json({ error: "answers required" }, { status: 400 });
  if (picked.size > 50) return NextResponse.json({ error: "한 번에 50문항까지" }, { status: 400 });

  const ids = [...picked.keys()];
  const { data: qs } = await db
    .from("bank_questions")
    .select("id, choices, answer_idx, explanation")
    .in("id", ids);
  if (!qs?.length) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rows: { question_id: string; user_id: string; chosen_idx: number; is_correct: boolean }[] = [];
  const results = qs.map((q) => {
    const chosen = picked.get(q.id)!;
    const isTheory = Array.isArray(q.choices) && q.choices.length > 0 && q.answer_idx !== null;
    const correct = isTheory && chosen === q.answer_idx;
    if (isTheory)
      rows.push({ question_id: q.id, user_id: uid, chosen_idx: chosen, is_correct: correct });
    return {
      questionId: q.id,
      chosen,
      correct,
      answerIdx: q.answer_idx,
      explanation: q.explanation ?? "",
    };
  });

  // 기록 실패는 점수에 영향 없다 (채점은 이미 끝났다)
  let saved = false;
  if (rows.length) {
    const { error } = await db.from("bank_attempts").insert(rows);
    if (error) console.error("bank batch insert:", error.message);
    else saved = true;
  }

  return NextResponse.json({
    ok: true,
    score: results.filter((r) => r.correct).length,
    total: results.length,
    saved,
    results,
  });
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
    .select("id, subject, category, type_tag, stem, choices, answer_idx, answer_text, explanation, images")
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
        images: q.images ?? null,
        chosen: w.chosen_idx,
        at: w.created_at,
      };
    })
    .filter(Boolean)
    .reverse();

  return NextResponse.json({ totals, notes });
}
