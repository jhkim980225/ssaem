import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";

// 응시용 문항 목록. **정답·해설은 내려보내지 않는다** — 네트워크 응답만 보고 답을 아는 것 차단.
// (채점은 POST submit이 하고, 그때 정답·해설을 준다. quiz와 같은 규약.)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const db = serviceClient();
  const { data: set } = await db
    .from("assessments")
    .select("id, title, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 남의 학원 평가 차단 (강사 본인은 통과 — 미리보기 가능)
  if (!(await sameAcademy(db, g.uid, set.teacher_id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // 이미 응시했으면 문항을 다시 주지 않는다 (1회 제한을 조회 단계에서도 지킨다)
  const { data: done } = await db
    .from("assessment_attempts")
    .select("id, score, total, submitted_at")
    .eq("assessment_id", id)
    .eq("student_id", g.uid)
    .maybeSingle();
  if (done)
    return NextResponse.json(
      {
        error: "이미 응시한 평가예요.",
        done: true,
        score: done.score,
        total: done.total,
        submittedAt: done.submitted_at,
      },
      { status: 409 }
    );

  const { data: qs, error } = await db
    .from("assessment_questions")
    .select("id, ord, question, choices")
    .eq("assessment_id", id)
    .order("ord", { ascending: true });
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });
  if (!qs?.length)
    return NextResponse.json({ error: "문항이 없는 평가예요." }, { status: 400 });

  return NextResponse.json({
    id: set.id,
    title: set.title,
    questions: qs.map((q) => ({ id: q.id, question: q.question, choices: q.choices })),
  });
}
