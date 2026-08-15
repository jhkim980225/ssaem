import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";

const LIMIT = 10; // 한 세션 문항 수

// 학생 문제 출제.
// GET ?teacher=<uuid>&course=<uuid>&mode=all|wrong
//   mode=wrong → 오답노트(내가 마지막에 틀린 문제만). 정답은 내려보내지 않는다.
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const url = new URL(req.url);
  const teacherId = (url.searchParams.get("teacher") ?? "").trim();
  const courseId = (url.searchParams.get("course") ?? "").trim();
  const mode = url.searchParams.get("mode") === "wrong" ? "wrong" : "all";
  if (!/^[0-9a-f-]{36}$/i.test(teacherId))
    return NextResponse.json({ error: "teacher required" }, { status: 400 });

  const db = serviceClient();
  const uid = g.uid;
  // 남의 학원 문제 목록을 uuid만 알면 볼 수 있던 것 차단
  if (!(await sameAcademy(db, uid, teacherId)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  let q = db
    .from("quiz_questions")
    .select("id, question, choices, course_id")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (/^[0-9a-f-]{36}$/i.test(courseId)) q = q.eq("course_id", courseId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  let questions = (data ?? []) as { id: string; question: string; choices: string[]; course_id: string | null }[];

  if (mode === "wrong") {
    if (!uid) return NextResponse.json({ questions: [], needLogin: true });
    const wrong = await wrongQuestionIds(db, uid);
    questions = questions.filter((x) => wrong.has(x.id));
  }

  // 정답·해설은 채점(POST /api/quiz/attempt) 때만 준다 — 응답만 보고 답 알아내는 것 차단
  return NextResponse.json({
    questions: questions.slice(0, LIMIT).map((x) => ({ id: x.id, question: x.question, choices: x.choices })),
    total: questions.length,
  });
}

// 학생별 "마지막 시도가 오답"인 문제 id 집합. 다시 맞히면 오답노트에서 빠진다.
export async function wrongQuestionIds(
  db: ReturnType<typeof serviceClient>,
  studentId: string
): Promise<Set<string>> {
  // 최신순으로 받아 문항별 '첫 등장 = 마지막 시도'만 채택 —
  // 오름차순+limit이면 시도가 1000건을 넘을 때 가장 오래된 기록으로 판정되던 것 차단.
  const { data } = await db
    .from("quiz_attempts")
    .select("question_id, correct, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1000);
  const last = new Map<string, boolean>();
  for (const a of (data ?? []) as { question_id: string; correct: boolean }[])
    if (!last.has(a.question_id)) last.set(a.question_id, a.correct);
  return new Set([...last.entries()].filter(([, ok]) => !ok).map(([id]) => id));
}
