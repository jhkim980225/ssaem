import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { grade, type SubmitAnswer } from "@/lib/assessment";
import { checkSignature, looksBlank } from "@/lib/signature";

// 평가 제출 → 서버 채점 → 응시·응답 저장 → (서명 있으면) 서명 기록.
// 응시는 1회 — DB unique(assessment_id, student_id)가 최종 방어선이다.
//
// 구글시트 전송(C)은 보류 상태라 여기서 하지 않는다. attempts.synced=false로 남으므로
// 나중에 연동을 켜면 미전송분을 그대로 밀어 넣을 수 있다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const uid = g.uid;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!rateLimit(`submit:${uid}`, 20, 60_000))
    return NextResponse.json({ error: "요청이 너무 잦아요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const answers: SubmitAnswer[] = Array.isArray(body?.answers) ? body.answers : [];
  const signature = body?.signature;

  const db = serviceClient();
  const { data: set } = await db
    .from("assessments")
    .select("id, title, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await sameAcademy(db, uid, set.teacher_id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  // 서명은 선택이지만, 보냈다면 형식이 맞아야 한다 (빈 서명·PNG 아닌 것 거부)
  if (signature !== undefined && signature !== null && signature !== "") {
    const check = checkSignature(signature);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    if (looksBlank(signature as string))
      return NextResponse.json({ error: "서명을 그려 주세요." }, { status: 400 });
  }

  // 정답은 서버 DB 값만 쓴다 — 클라이언트가 보낸 정답은 신뢰하지 않는다
  const { data: qs } = await db
    .from("assessment_questions")
    .select("id, ord, answer, explanation, question, choices")
    .eq("assessment_id", id)
    .order("ord", { ascending: true });
  if (!qs?.length) return NextResponse.json({ error: "문항이 없는 평가예요." }, { status: 400 });

  const g2 = grade(
    qs.map((q) => ({ id: q.id, answer: q.answer })),
    answers
  );

  const { data: attempt, error: aerr } = await db
    .from("assessment_attempts")
    .insert({ assessment_id: id, student_id: uid, score: g2.score, total: g2.total })
    .select("id, submitted_at")
    .single();
  if (aerr || !attempt) {
    // 23505 = unique 위반 = 이미 응시 (경합으로 동시에 두 번 눌러도 여기서 걸린다)
    if (aerr?.code === "23505") {
      const { data: prev } = await db
        .from("assessment_attempts")
        .select("score, total, submitted_at")
        .eq("assessment_id", id)
        .eq("student_id", uid)
        .maybeSingle();
      return NextResponse.json(
        {
          error: "이미 응시한 평가예요.",
          done: true,
          score: prev?.score ?? null,
          total: prev?.total ?? null,
          submittedAt: prev?.submitted_at ?? null,
        },
        { status: 409 }
      );
    }
    console.error("attempt insert:", aerr?.message);
    return NextResponse.json({ error: "제출하지 못했어요." }, { status: 500 });
  }

  // 문항별 응답 (미응답 chosen=-1은 저장하지 않는다 — 컬럼 check(0~3) 위반)
  const rows = g2.rows
    .filter((r) => r.chosen >= 0)
    .map((r) => ({
      attempt_id: attempt.id,
      question_id: r.questionId,
      chosen: r.chosen,
      correct: r.correct,
    }));
  if (rows.length) {
    const { error: rerr } = await db.from("assessment_responses").insert(rows);
    if (rerr) console.error("responses insert:", rerr.message); // 점수는 이미 확정 — 막지 않는다
  }

  // 전자서명 기록 (실패해도 응시 결과엔 영향 없음)
  let signedAt: string | null = null;
  if (signature) {
    const { data: sig, error: sigErr } = await db
      .from("signatures")
      .insert({
        user_id: uid,
        kind: "assessment",
        ref_id: attempt.id,
        image: signature,
        ip: clientIp(req),
        user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
      })
      .select("signed_at")
      .single();
    if (sigErr) console.error("signature insert:", sigErr.message);
    else signedAt = sig?.signed_at ?? null;
  }

  const byId = new Map(qs.map((q) => [q.id, q]));
  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    score: g2.score,
    total: g2.total,
    submittedAt: attempt.submitted_at,
    signedAt,
    // 채점 후이므로 정답·해설 공개
    results: g2.rows.map((r) => {
      const q = byId.get(r.questionId);
      return {
        questionId: r.questionId,
        question: q?.question ?? "",
        choices: q?.choices ?? [],
        chosen: r.chosen,
        answer: q?.answer ?? 0,
        correct: r.correct,
        explanation: q?.explanation ?? "",
      };
    }),
  });
}
