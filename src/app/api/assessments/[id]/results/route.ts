import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser, userWithRole } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { toCsv, type ResultRow } from "@/lib/results-csv";

// 평가 응시 결과 (강사·원장 전용).
//
//   GET /api/assessments/<id>/results          → JSON (화면 표시용)
//   GET /api/assessments/<id>/results?csv=1    → CSV 파일 (구글시트에 붙여넣기용)
//
// 학생은 접근 불가 — 남의 점수를 볼 수 있으면 안 된다.
// 강사는 본인 평가만, 원장은 우리 학원 강사의 평가면 전부.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const me = await userWithRole(req);
  if (me?.role !== "teacher" && me?.role !== "admin")
    return NextResponse.json({ error: "강사·원장만 볼 수 있어요." }, { status: 403 });

  const db = serviceClient();
  const { data: set } = await db
    .from("assessments")
    .select("id, title, teacher_id")
    .eq("id", id)
    .maybeSingle();
  if (!set) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 소유권: 강사는 본인 평가만 / 원장은 우리 학원 강사의 평가만
  if (me.role === "teacher") {
    if (set.teacher_id !== g.uid) return NextResponse.json({ error: "not found" }, { status: 404 });
  } else {
    const mine = await academyOf(db, g.uid);
    const { data: t } = await db
      .from("profiles")
      .select("academy_id")
      .eq("id", set.teacher_id)
      .maybeSingle();
    if (!mine || t?.academy_id !== mine)
      return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const [{ data: qs }, { data: attempts }, { data: teacher }] = await Promise.all([
    db.from("assessment_questions").select("id, ord").eq("assessment_id", id).order("ord"),
    db
      .from("assessment_attempts")
      .select("id, student_id, score, total, submitted_at")
      .eq("assessment_id", id)
      .order("submitted_at", { ascending: false }),
    db.from("profiles").select("name, academy_id").eq("id", set.teacher_id).maybeSingle(),
  ]);

  const attemptIds = (attempts ?? []).map((a) => a.id);
  const studentIds = [...new Set((attempts ?? []).map((a) => a.student_id))];

  const [{ data: responses }, { data: students }, { data: sigs }, { data: academy }] = await Promise.all([
    attemptIds.length
      ? db.from("assessment_responses").select("attempt_id, question_id, chosen, correct").in("attempt_id", attemptIds)
      : Promise.resolve({ data: [] as { attempt_id: string; question_id: string; chosen: number; correct: boolean }[] }),
    studentIds.length
      ? db.from("profiles").select("id, name").in("id", studentIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    attemptIds.length
      ? db.from("signatures").select("ref_id, signed_at").eq("kind", "assessment").in("ref_id", attemptIds)
      : Promise.resolve({ data: [] as { ref_id: string; signed_at: string }[] }),
    teacher?.academy_id
      ? db.from("academies").select("name").eq("id", teacher.academy_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  const nameOf = new Map((students ?? []).map((s) => [s.id, s.name]));
  const signedAt = new Map((sigs ?? []).map((s) => [s.ref_id, s.signed_at]));
  const order = (qs ?? []).map((q) => q.id);

  // 문항별 정오를 attempt별로 모아 OXOX 문자열로 (미응답은 -)
  const byAttempt = new Map<string, Map<string, boolean>>();
  for (const r of responses ?? []) {
    const m = byAttempt.get(r.attempt_id) ?? new Map<string, boolean>();
    m.set(r.question_id, r.correct);
    byAttempt.set(r.attempt_id, m);
  }

  const rows: ResultRow[] = (attempts ?? []).map((a) => {
    const m = byAttempt.get(a.id) ?? new Map<string, boolean>();
    const marks = order.map((qid) => (m.has(qid) ? (m.get(qid) ? "O" : "X") : "-")).join("");
    return {
      submittedAt: a.submitted_at,
      academy: academy?.name ?? "",
      teacher: teacher?.name ?? "",
      assessment: set.title,
      student: nameOf.get(a.student_id) ?? "",
      score: a.score,
      total: a.total,
      percent: a.total ? Math.round((a.score / a.total) * 100) : 0,
      signedAt: signedAt.get(a.id) ?? "",
      marks,
    };
  });

  if (new URL(req.url).searchParams.get("csv") === "1") {
    // 엑셀·구글시트가 한글을 깨뜨리지 않게 UTF-8 BOM을 붙인다
    const csv = "﻿" + toCsv(rows);
    const filename = encodeURIComponent(`${set.title}_결과.csv`);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    title: set.title,
    questions: order.length,
    attempts: rows.length,
    results: rows,
  });
}
