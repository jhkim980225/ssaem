import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole, requireRole } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 과제 제출 — 달력 수업 자료(document)에 학생이 텍스트로 제출한다.
// POST {documentId, content} (학생): 제출/재제출 (문서당 1건 upsert)
// GET ?mine=1              (학생): 내 제출 전체 (마이페이지·달력 표시용)
// GET ?course=<id>         (강사): 그 강좌 수업별 제출 현황 + 수강생 명단 (미제출 계산용)

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  const g = await requireRole(req, "student");
  if ("res" in g) return g.res;
  if (!rateLimit(`submit:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const documentId = (body?.documentId ?? "").toString();
  const content = (body?.content ?? "").toString().trim().slice(0, 4000);
  if (!UUID.test(documentId) || !content)
    return NextResponse.json({ error: "documentId와 내용이 필요해요" }, { status: 400 });

  const db = serviceClient();
  const { data: doc } = await db
    .from("documents")
    .select("id, teacher_id, course_id, lesson_date")
    .eq("id", documentId)
    .maybeSingle();
  // 수업(달력) 자료에만 제출 가능
  if (!doc || !doc.lesson_date) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!(await sameAcademy(db, g.uid, doc.teacher_id)))
    return NextResponse.json({ error: "not found" }, { status: 404 });
  // ROOM 자료면 그 ROOM 수강생만 (공용 수업은 같은 학원이면 허용 — 달력 노출 규칙과 동일)
  if (doc.course_id) {
    const { data: enr } = await db
      .from("enrollments")
      .select("student_id")
      .eq("course_id", doc.course_id)
      .eq("student_id", g.uid)
      .maybeSingle();
    if (!enr) return NextResponse.json({ error: "이 강좌 수강생만 제출할 수 있어요" }, { status: 403 });
  }

  const { error } = await db.from("submissions").upsert(
    { document_id: documentId, student_id: g.uid, content, updated_at: new Date().toISOString() },
    { onConflict: "document_id,student_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const db = serviceClient();

  // 학생: 내 제출 전체
  if (url.searchParams.get("mine")) {
    if (me.role !== "student") return NextResponse.json({ error: "학생 계정만 쓸 수 있어요" }, { status: 403 });
    const { data } = await db
      .from("submissions")
      .select("document_id, content, updated_at, documents!inner(title, lesson_date)")
      .eq("student_id", me.uid)
      .order("updated_at", { ascending: false })
      .limit(200);
    type Row = {
      document_id: string;
      content: string;
      updated_at: string;
      documents: { title: string | null; lesson_date: string | null } | { title: string | null; lesson_date: string | null }[];
    };
    const submissions = ((data ?? []) as Row[]).map((s) => {
      const d = Array.isArray(s.documents) ? s.documents[0] : s.documents;
      return {
        documentId: s.document_id,
        content: s.content,
        updatedAt: s.updated_at,
        title: d?.title ?? "수업 자료",
        date: d?.lesson_date ?? null,
      };
    });
    return NextResponse.json({ submissions });
  }

  // 강사: 강좌별 제출 현황 (역할 검사를 파라미터 검증보다 먼저 — 비강사에겐 403이 정답)
  const t = await requireRole(req, "teacher");
  if ("res" in t) return t.res;
  const courseId = (url.searchParams.get("course") ?? "").toString();
  if (!UUID.test(courseId)) return NextResponse.json({ error: "course required" }, { status: 400 });
  const { data: course } = await db
    .from("courses")
    .select("id, teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.teacher_id !== t.uid) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [{ data: docs }, { data: enr }] = await Promise.all([
    db
      .from("documents")
      .select("id, title, lesson_date")
      .eq("course_id", courseId)
      .not("lesson_date", "is", null)
      .order("lesson_date", { ascending: false })
      .limit(50),
    db
      .from("enrollments")
      .select("student_id, profiles!inner(name, role)")
      .eq("course_id", courseId)
      .eq("profiles.role", "student"),
  ]);
  type ERow = { student_id: string; profiles: { name: string } | { name: string }[] };
  const roster = ((enr ?? []) as ERow[]).map((e) => ({
    id: e.student_id,
    name: (Array.isArray(e.profiles) ? e.profiles[0]?.name : e.profiles?.name) ?? "이름 없음",
  }));

  const docIds = (docs ?? []).map((d) => d.id);
  const { data: subs } = docIds.length
    ? await db
        .from("submissions")
        .select("document_id, student_id, content, updated_at")
        .in("document_id", docIds)
    : { data: [] };
  type SRow = { document_id: string; student_id: string; content: string; updated_at: string };
  const nameOf = new Map(roster.map((r) => [r.id, r.name]));
  const byDoc = new Map<string, { studentId: string; name: string; content: string; updatedAt: string }[]>();
  for (const s of (subs ?? []) as SRow[]) {
    const list = byDoc.get(s.document_id) ?? [];
    list.push({
      studentId: s.student_id,
      name: nameOf.get(s.student_id) ?? "이름 없음",
      content: s.content,
      updatedAt: s.updated_at,
    });
    byDoc.set(s.document_id, list);
  }

  return NextResponse.json({
    roster,
    lessons: (docs ?? []).map((d) => ({
      id: d.id,
      title: d.title ?? "수업 자료",
      date: d.lesson_date,
      submissions: byDoc.get(d.id) ?? [],
    })),
  });
}
