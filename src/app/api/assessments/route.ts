import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser, requireRole, userWithRole } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";
import { ownCourseOrNull } from "@/lib/documents";
import { parseAssessmentFile, MAX_QUESTIONS } from "@/lib/assessment";

export const runtime = "nodejs";

// 평가 세트.
//   POST   multipart(file,title,courseId)  강사 — 엑셀/CSV 업로드로 평가 생성
//   GET    ?teacher=<uuid>                 학생: 응시 가능한 평가 목록 / 강사: 내 평가 목록
//   DELETE ?id=<uuid>                      강사 — 내 평가 삭제 (응시 기록도 cascade)

const MAX_FILE = 2 * 1024 * 1024; // 2MB — 문항 200개면 충분하다

export async function POST(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  // 파싱은 CPU를 쓴다 — 본문 읽기 전에 막는다
  if (!rateLimit(`assessment:${uid}`, 20, 3_600_000))
    return NextResponse.json({ error: "업로드가 너무 잦아요. 잠시 후 다시 시도해 주세요." }, { status: 429 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const title = (form?.get("title") ?? "").toString().trim().slice(0, 80);
  if (!(file instanceof File)) return NextResponse.json({ error: "파일을 선택해 주세요." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "평가 이름을 입력해 주세요." }, { status: 400 });
  if (file.size > MAX_FILE)
    return NextResponse.json({ error: "파일은 2MB 이하로 올려 주세요." }, { status: 400 });

  let parsed;
  try {
    parsed = parseAssessmentFile(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    console.error("assessment parse:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "파일을 읽지 못했어요. 양식을 확인해 주세요." }, { status: 400 });
  }
  if (!parsed.questions.length)
    return NextResponse.json(
      { error: "문항을 하나도 읽지 못했어요. 양식(문제·보기1~4·정답)을 확인해 주세요." },
      { status: 400 }
    );

  const db = serviceClient();
  const courseId = await ownCourseOrNull(uid, form?.get("courseId"));

  const { data: set, error: serr } = await db
    .from("assessments")
    .insert({ teacher_id: uid, course_id: courseId, title })
    .select("id")
    .single();
  if (serr || !set) {
    console.error("assessment insert:", serr?.message);
    return NextResponse.json({ error: "평가를 만들지 못했어요." }, { status: 500 });
  }

  const rows = parsed.questions.map((q, i) => ({
    assessment_id: set.id,
    ord: i,
    question: q.question,
    choices: q.choices,
    answer: q.answer,
    explanation: q.explanation,
  }));
  const { error: qerr } = await db.from("assessment_questions").insert(rows);
  if (qerr) {
    // 문항이 없는 껍데기 평가가 남지 않게 되돌린다 (자료 등록과 같은 규칙)
    await db.from("assessments").delete().eq("id", set.id);
    console.error("assessment questions insert:", qerr.message);
    return NextResponse.json({ error: "문항을 저장하지 못했어요." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: set.id,
    created: rows.length,
    skipped: parsed.skipped,
    max: MAX_QUESTIONS,
  });
}

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const uid = g.uid;

  const url = new URL(req.url);
  const teacherParam = (url.searchParams.get("teacher") ?? "").trim();
  const db = serviceClient();
  const me = await userWithRole(req);

  // 강사는 teacher 파라미터 없이 부르면 본인 평가 목록(관리용)
  const teacherId =
    /^[0-9a-f-]{36}$/i.test(teacherParam) ? teacherParam : me?.role === "teacher" ? uid : "";
  if (!teacherId) return NextResponse.json({ error: "teacher required" }, { status: 400 });

  // 남의 학원 평가를 uuid만 알면 보는 것 차단 (강사 본인은 통과)
  if (!(await sameAcademy(db, uid, teacherId)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: sets, error } = await db
    .from("assessments")
    .select("id, title, course_id, created_at")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });

  const ids = (sets ?? []).map((s) => s.id);
  if (!ids.length) return NextResponse.json({ assessments: [] });

  // 문항 수 + 내 응시 여부를 한 번에 (목록에서 "완료" 표시용)
  const [{ data: qs }, { data: mine }] = await Promise.all([
    db.from("assessment_questions").select("assessment_id").in("assessment_id", ids),
    db
      .from("assessment_attempts")
      .select("assessment_id, score, total, submitted_at")
      .eq("student_id", uid)
      .in("assessment_id", ids),
  ]);
  const count = new Map<string, number>();
  for (const q of qs ?? []) count.set(q.assessment_id, (count.get(q.assessment_id) ?? 0) + 1);
  const attempt = new Map((mine ?? []).map((a) => [a.assessment_id, a]));

  return NextResponse.json({
    assessments: (sets ?? []).map((s) => {
      const a = attempt.get(s.id);
      return {
        id: s.id,
        title: s.title,
        courseId: s.course_id,
        questions: count.get(s.id) ?? 0,
        createdAt: s.created_at,
        // 응시 이력이 있으면 점수까지 (재응시 차단은 서버가 강제)
        done: Boolean(a),
        score: a?.score ?? null,
        total: a?.total ?? null,
        submittedAt: a?.submitted_at ?? null,
      };
    }),
  });
}

export async function DELETE(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = serviceClient();
  // 소유권은 역할과 별개 — 내 평가인지 먼저 확인한다
  const { data: mine } = await db
    .from("assessments")
    .select("id")
    .eq("id", id)
    .eq("teacher_id", gate.uid)
    .maybeSingle();
  if (!mine) return NextResponse.json({ error: "not found" }, { status: 404 });

  // 전자서명은 signatures.ref_id로 느슨하게 연결돼 있어(FK 아님) cascade가 안 걸린다.
  // 평가를 지우면 응시 기록은 사라지는데 **서명 이미지(개인정보)만 남는** 문제가 있어
  // 삭제 전에 해당 응시의 서명을 먼저 정리한다.
  const { data: attempts } = await db
    .from("assessment_attempts")
    .select("id")
    .eq("assessment_id", id);
  const attemptIds = (attempts ?? []).map((a) => a.id);
  if (attemptIds.length) {
    const { error: sigErr } = await db
      .from("signatures")
      .delete()
      .eq("kind", "assessment")
      .in("ref_id", attemptIds);
    if (sigErr) console.error("signature cleanup:", sigErr.message);
  }

  const { error } = await db.from("assessments").delete().eq("id", id).eq("teacher_id", gate.uid);
  if (error) return NextResponse.json({ error: "삭제하지 못했어요." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
