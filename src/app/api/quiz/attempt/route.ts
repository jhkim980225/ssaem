import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 채점. 정답 판정은 서버에서만 — 클라이언트는 정답을 모른다.
// POST { questionId, chosen }
// 로그인 학생이면 기록을 남겨 오답노트에 쌓고, 비로그인이면 채점만 해준다.
export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
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
    .select("id, answer, explanation, teacher_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!q) return NextResponse.json({ error: "not found" }, { status: 404 });
  // 채점 응답이 정답·해설을 주므로, 학원 경계를 여기서도 막아야 한다.
  // 안 막으면 questionId만 알면 남의 학원 정답표를 한 문항씩 긁어갈 수 있다.
  if (!(await sameAcademy(db, g.uid, q.teacher_id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const correct = chosen === q.answer;

  // 로그인 학생만 기록 (오답노트용). 실패해도 채점 결과는 돌려준다.
  const uid = g.uid;
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
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const uid = g.uid;

  const db = serviceClient();
  const { data } = await db
    .from("quiz_attempts")
    .select("question_id, correct, chosen, created_at")
    .eq("student_id", uid)
    .order("created_at", { ascending: true })
    .limit(1000);

  type A = { question_id: string; correct: boolean; chosen: number; created_at: string };
  // 한 번이라도 틀린 문제는 전부 기록으로 남긴다 — 다시 맞히면 cleared(극복)로 표시만 바뀐다.
  const last = new Map<string, A>(); // 문항별 마지막 시도
  const lastWrong = new Map<string, A>(); // 문항별 마지막 오답 시도 (내 답 표시용)
  const wrongCount = new Map<string, number>();
  for (const a of (data ?? []) as A[]) {
    last.set(a.question_id, a);
    if (!a.correct) {
      lastWrong.set(a.question_id, a);
      wrongCount.set(a.question_id, (wrongCount.get(a.question_id) ?? 0) + 1);
    }
  }
  const wrong = [...lastWrong.values()]; // 한 번이라도 틀린 문제 전부
  const remaining = wrong.filter((w) => !last.get(w.question_id)!.correct).length;

  const totals = {
    attempted: last.size,
    wrong: remaining, // 아직 못 맞힌 오답 — /quiz?mode=wrong 대상과 일치
    correct: last.size - remaining,
    overcome: wrong.length - remaining, // 틀렸다가 다시 맞힌 문제
  };
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
        // teacher_id도 준다 — 오답노트에서 "이 선생님 오답만 다시 풀기"로 넘길 때 필요
        teacherId: q.teacher_id,
        teacher: nameOf.get(q.teacher_id) ?? "선생님",
        at: w.created_at,
        cleared: last.get(w.question_id)!.correct, // 극복(다시 맞힘) 여부
        wrongCount: wrongCount.get(w.question_id) ?? 1,
      };
    })
    .filter(Boolean)
    .reverse();

  return NextResponse.json({ totals, notes });
}
