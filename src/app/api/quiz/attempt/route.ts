import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 채점. 정답 판정은 서버에서만 — 클라이언트는 정답을 모른다.
// POST { questionId, chosen }
// 로그인 학생이면 기록을 남겨 오답노트에 쌓고, 비로그인이면 채점만 해준다.
export async function POST(req: Request) {
  if (!rateLimit(`attempt:${clientIp(req)}`, 120, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const questionId = (body?.questionId ?? "").toString();
  const chosen = Number(body?.chosen);
  if (!/^[0-9a-f-]{36}$/i.test(questionId) || !Number.isInteger(chosen) || chosen < 0 || chosen > 3)
    return NextResponse.json({ error: "questionId, chosen(0~3) required" }, { status: 400 });

  const db = serviceClient();
  const { data: q } = await db
    .from("quiz_questions")
    .select("id, answer, explanation")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });

  const correct = chosen === q.answer;

  // 로그인 학생만 기록 (오답노트용). 실패해도 채점 결과는 돌려준다.
  const uid = await userFromRequest(req);
  if (uid) {
    const { error } = await db
      .from("quiz_attempts")
      .insert({ question_id: q.id, student_id: uid, chosen, correct });
    if (error) console.error("attempt insert:", error.message);
  }

  return NextResponse.json({ correct, answer: q.answer, explanation: q.explanation ?? "", saved: Boolean(uid) });
}

// 오답노트 요약 (학생 본인)
export async function GET(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = serviceClient();
  const { data } = await db
    .from("quiz_attempts")
    .select("question_id, correct, chosen, created_at")
    .eq("student_id", uid)
    .order("created_at", { ascending: true })
    .limit(1000);

  type A = { question_id: string; correct: boolean; chosen: number; created_at: string };
  const last = new Map<string, A>();
  for (const a of (data ?? []) as A[]) last.set(a.question_id, a);
  const wrong = [...last.values()].filter((a) => !a.correct);

  const totals = { attempted: last.size, wrong: wrong.length, correct: last.size - wrong.length };
  if (!wrong.length) return NextResponse.json({ totals, notes: [] });

  const { data: qs } = await db
    .from("quiz_questions")
    .select("id, question, choices, answer, explanation, teacher_id")
    .in("id", wrong.map((w) => w.question_id));
  const { data: teachers } = await db
    .from("profiles")
    .select("id, name")
    .in("id", [...new Set((qs ?? []).map((q) => q.teacher_id))]);
  const nameOf = new Map((teachers ?? []).map((t) => [t.id, t.name]));

  const byId = new Map((qs ?? []).map((q) => [q.id, q]));
  const notes = wrong
    .map((w) => {
      const q = byId.get(w.question_id);
      if (!q) return null;
      return {
        id: q.id,
        question: q.question,
        choices: q.choices,
        answer: q.answer,
        explanation: q.explanation,
        chosen: w.chosen,
        teacher: nameOf.get(q.teacher_id) ?? "선생님",
        at: w.created_at,
      };
    })
    .filter(Boolean)
    .reverse();

  return NextResponse.json({ totals, notes });
}
