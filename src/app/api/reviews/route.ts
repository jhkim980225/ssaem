import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser, userWithRole } from "@/lib/auth";
import { sameAcademy, academyOf, teacherIdsOf } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";

// 수강평 (학생 → 강사). 별점 1~5 + 한 줄 코멘트.
//
//   POST { teacherId, rating, comment }  학생 — 작성/수정 (강사당 1건, upsert)
//   GET                                  역할별로 다르게 준다:
//     학생 : 내가 쓴 수강평 (수정 폼 채우기용)
//     강사 : 내 수강평 — **작성자 익명** (이름·id 미포함)
//     원장 : 우리 학원 강사별 수강평 — **작성자 실명** (관리 목적)
//
// ⚠️ message_feedback(AI 답변 평가)과 다른 개념이다.

const MAX_COMMENT = 300;

export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const uid = g.uid;

  if (!rateLimit(`review:${uid}`, 20, 60_000))
    return NextResponse.json({ error: "요청이 너무 잦아요." }, { status: 429 });

  const me = await userWithRole(req);
  // 수강평은 학생만 쓴다 — 강사가 자기 평점을 올리거나 남의 강사를 깎는 것 차단
  if (me?.role !== "student")
    return NextResponse.json({ error: "학생만 수강평을 쓸 수 있어요." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const teacherId = (body?.teacherId ?? "").toString();
  const rating = Number(body?.rating);
  const comment = (body?.comment ?? "").toString().trim().slice(0, MAX_COMMENT) || null;
  if (!/^[0-9a-f-]{36}$/i.test(teacherId))
    return NextResponse.json({ error: "teacherId required" }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return NextResponse.json({ error: "별점을 골라 주세요." }, { status: 400 });

  const db = serviceClient();
  // 남의 학원 강사에게 수강평을 남기는 것 차단
  if (!(await sameAcademy(db, uid, teacherId)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await db
    .from("course_reviews")
    .upsert(
      { teacher_id: teacherId, student_id: uid, rating, comment, updated_at: new Date().toISOString() },
      { onConflict: "teacher_id,student_id" }
    );
  if (error) {
    console.error("review upsert:", error.message);
    return NextResponse.json({ error: "저장하지 못했어요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const uid = g.uid;
  const db = serviceClient();
  const me = await userWithRole(req);

  // ── 원장: 우리 학원 강사 전체의 수강평 (작성자 실명)
  if (me?.role === "admin") {
    const academyId = await academyOf(db, uid);
    if (!academyId) return NextResponse.json({ reviews: [], byTeacher: [] });
    const teacherIds = await teacherIdsOf(db, academyId);
    if (!teacherIds.length) return NextResponse.json({ reviews: [], byTeacher: [] });

    const { data } = await db
      .from("course_reviews")
      .select("id, teacher_id, student_id, rating, comment, updated_at")
      .in("teacher_id", teacherIds)
      .order("updated_at", { ascending: false })
      .limit(300);
    const rows = data ?? [];

    // 이름 붙이기 (강사·학생 모두 우리 학원 사람)
    const ids = [...new Set([...rows.map((r) => r.teacher_id), ...rows.map((r) => r.student_id)])];
    const { data: people } = ids.length
      ? await db.from("profiles").select("id, name").in("id", ids)
      : { data: [] as { id: string; name: string }[] };
    const nameOf = new Map((people ?? []).map((p) => [p.id, p.name]));

    const agg = new Map<string, { sum: number; n: number }>();
    for (const r of rows) {
      const a = agg.get(r.teacher_id) ?? { sum: 0, n: 0 };
      a.sum += r.rating;
      a.n++;
      agg.set(r.teacher_id, a);
    }

    return NextResponse.json({
      reviews: rows.map((r) => ({
        id: r.id,
        teacherId: r.teacher_id,
        teacher: nameOf.get(r.teacher_id) ?? "",
        student: nameOf.get(r.student_id) ?? "", // 원장에게만 실명
        rating: r.rating,
        comment: r.comment,
        updatedAt: r.updated_at,
      })),
      byTeacher: [...agg.entries()].map(([id, a]) => ({
        teacherId: id,
        teacher: nameOf.get(id) ?? "",
        count: a.n,
        avg: Math.round((a.sum / a.n) * 10) / 10,
      })),
    });
  }

  // ── 강사: 내 수강평 (작성자 익명 — student_id를 아예 응답에 싣지 않는다)
  if (me?.role === "teacher") {
    const { data } = await db
      .from("course_reviews")
      .select("id, rating, comment, updated_at")
      .eq("teacher_id", uid)
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = data ?? [];
    const n = rows.length;
    const avg = n ? Math.round((rows.reduce((s, r) => s + r.rating, 0) / n) * 10) / 10 : null;
    return NextResponse.json({
      count: n,
      avg,
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        updatedAt: r.updated_at,
      })),
    });
  }

  // ── 학생: 내가 쓴 수강평 (수정 폼을 채우기 위해)
  const { data } = await db
    .from("course_reviews")
    .select("teacher_id, rating, comment, updated_at")
    .eq("student_id", uid);
  return NextResponse.json({
    mine: (data ?? []).map((r) => ({
      teacherId: r.teacher_id,
      rating: r.rating,
      comment: r.comment,
      updatedAt: r.updated_at,
    })),
  });
}
