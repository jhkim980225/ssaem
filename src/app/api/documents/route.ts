import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { saveDocument, updateDocument, logDocumentEvent, ownCourseOrNull } from "@/lib/documents";
import { docLimitError } from "@/lib/plan";

const MAX_CONTENT = 200_000; // 임베딩 비용·메모리 방어

// 내 문서 목록 (청크 수 포함)
export async function GET(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;
  const db = serviceClient();
  const { data, error } = await db
    .from("documents")
    .select("id, kind, title, source, raw_text, created_at, course_id, courses(title), chunks(count)")
    .eq("teacher_id", uid)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; kind: string; title: string | null; source: string;
    raw_text: string; created_at: string; chunks: { count: number }[];
    course_id: string | null; courses: { title: string } | { title: string }[] | null;
  };
  const documents = ((data ?? []) as Row[]).map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    source: d.source,
    preview: d.raw_text.slice(0, 120),
    raw: d.source === "text" ? d.raw_text : "", // 수정 프리필용 (PDF는 수정 불가)
    chunks: d.chunks?.[0]?.count ?? 0,
    created_at: d.created_at,
    // 목록에서 어느 강좌 자료인지 보이게 (43건이 뒤섞이면 구분이 안 된다)
    course_id: d.course_id,
    course: (Array.isArray(d.courses) ? d.courses[0]?.title : d.courses?.title) ?? null,
  }));
  return NextResponse.json({ documents });
}

// 텍스트 자료 등록
export async function POST(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  // 텍스트 등록·수정도 청킹 + 임베딩을 돌린다(수정은 재임베딩). 업로드와 같은 비용 계열이라
  // 같이 막는다 — 한쪽만 막으면 뚫린 쪽으로 돌아간다.
  if (!rateLimit(`docwrite:${uid}`, 60, 3_600_000))
    return NextResponse.json(
      { error: "자료 등록이 너무 잦아요. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );

  const body = await req.json().catch(() => null);
  const content = (body?.content ?? "").toString().trim();
  const kind = body?.kind === "style" ? "style" : "problem";
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
  if (content.length > MAX_CONTENT)
    return NextResponse.json({ error: `자료는 ${MAX_CONTENT.toLocaleString()}자 이하로 등록해주세요` }, { status: 400 });
  const limitMsg = await docLimitError(serviceClient(), uid);
  if (limitMsg) return NextResponse.json({ error: limitMsg }, { status: 403 });
  const courseId = await ownCourseOrNull(uid, body?.courseId);

  try {
    const r = await saveDocument({ teacherId: uid, kind, rawText: content, source: "text", courseId });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패" }, { status: 500 });
  }
}

// 텍스트 자료 수정 (원문 교체 → 재청킹·재임베딩)
export async function PATCH(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  // 텍스트 등록·수정도 청킹 + 임베딩을 돌린다(수정은 재임베딩). 업로드와 같은 비용 계열이라
  // 같이 막는다 — 한쪽만 막으면 뚫린 쪽으로 돌아간다.
  if (!rateLimit(`docwrite:${uid}`, 60, 3_600_000))
    return NextResponse.json(
      { error: "자료 등록이 너무 잦아요. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );

  const body = await req.json().catch(() => null);
  const id = (body?.id ?? "").toString();
  const content = (body?.content ?? "").toString().trim();
  if (!id || !content) return NextResponse.json({ error: "id, content required" }, { status: 400 });
  if (content.length > MAX_CONTENT)
    return NextResponse.json({ error: `자료는 ${MAX_CONTENT.toLocaleString()}자 이하로 등록해주세요` }, { status: 400 });

  try {
    const r = await updateDocument({ documentId: id, teacherId: uid, rawText: content });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "실패";
    return NextResponse.json({ error: msg }, { status: msg === "not found" ? 404 : 500 });
  }
}

// 문서 삭제 (?id=...). chunks는 cascade.
export async function DELETE(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;
  const id = new URL(req.url).searchParams.get("id");
  // uuid 형식 검사 — 안 하면 잘못된 id가 그대로 DB로 가서 500이 난다 (400이 맞다)
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return NextResponse.json({ error: "id required" }, { status: 400 });
  const db = serviceClient();

  // 기록용으로 삭제 전에 정보 확보 (지운 뒤엔 못 읽음)
  const { data: doc } = await db
    .from("documents")
    .select("id, title, kind, source, chunks(count)")
    .eq("id", id)
    .eq("teacher_id", uid)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  const chunkCount = (doc.chunks as { count: number }[] | null)?.[0]?.count ?? 0;

  const { error } = await db.from("documents").delete().eq("id", id).eq("teacher_id", uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logDocumentEvent({
    teacherId: uid,
    documentId: null, // 문서는 지워졌으므로 NULL. 정보는 아래 필드로 보존.
    action: "deleted",
    title: doc.title,
    kind: doc.kind,
    source: doc.source,
    chunks: chunkCount,
  });

  return NextResponse.json({ ok: true });
}
