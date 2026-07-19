import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { teacherFromRequest } from "@/lib/auth";
import { saveDocument, logDocumentEvent } from "@/lib/documents";

// 내 문서 목록 (청크 수 포함)
export async function GET(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const { data, error } = await db
    .from("documents")
    .select("id, kind, title, source, raw_text, created_at, chunks(count)")
    .eq("teacher_id", uid)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; kind: string; title: string | null; source: string;
    raw_text: string; created_at: string; chunks: { count: number }[];
  };
  const documents = ((data ?? []) as Row[]).map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title,
    source: d.source,
    preview: d.raw_text.slice(0, 120),
    chunks: d.chunks?.[0]?.count ?? 0,
    created_at: d.created_at,
  }));
  return NextResponse.json({ documents });
}

// 텍스트 자료 등록
export async function POST(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const content = (body?.content ?? "").toString().trim();
  const kind = body?.kind === "style" ? "style" : "problem";
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });

  try {
    const r = await saveDocument({ teacherId: uid, kind, rawText: content, source: "text" });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패" }, { status: 500 });
  }
}

// 문서 삭제 (?id=...). chunks는 cascade.
export async function DELETE(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
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
