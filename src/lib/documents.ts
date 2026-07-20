import { serviceClient } from "./supabase";
import { embed } from "./embed";
import { chunkText } from "./chunk";

// 원본 문서 저장 + 청킹 + 청크별 임베딩. 텍스트/PDF 공용.
export async function saveDocument(opts: {
  teacherId: string;
  kind: "problem" | "style";
  rawText: string;
  title?: string | null;
  source: "text" | "pdf";
  courseId?: string | null;
}): Promise<{ documentId: string; chunks: number }> {
  const db = serviceClient();

  const { data: doc, error: derr } = await db
    .from("documents")
    .insert({
      teacher_id: opts.teacherId,
      course_id: opts.courseId ?? null,
      kind: opts.kind,
      title: opts.title ?? opts.rawText.slice(0, 40),
      source: opts.source,
      raw_text: opts.rawText,
    })
    .select("id")
    .single();
  if (derr) throw derr;

  const pieces = chunkText(opts.rawText);
  const rows = [];
  for (let i = 0; i < pieces.length; i++) {
    rows.push({
      document_id: doc.id,
      teacher_id: opts.teacherId,
      ord: i,
      content: pieces[i],
      embedding: await embed(pieces[i]),
    });
  }
  const { error: cerr } = await db.from("chunks").insert(rows);
  if (cerr) throw cerr;

  await logDocumentEvent({
    teacherId: opts.teacherId,
    documentId: doc.id,
    action: "created",
    title: opts.title ?? opts.rawText.slice(0, 40),
    kind: opts.kind,
    source: opts.source,
    chunks: rows.length,
  });

  return { documentId: doc.id, chunks: rows.length };
}

// 텍스트 문서 수정: 원문 교체 → 재청킹 → 재임베딩.
// 감사로그는 deleted+created 쌍 (action check 제약에 'updated' 없음 — 마이그레이션 회피).
export async function updateDocument(opts: {
  documentId: string;
  teacherId: string;
  rawText: string;
}): Promise<{ chunks: number }> {
  const db = serviceClient();

  const { data: doc } = await db
    .from("documents")
    .select("id, title, kind, source, chunks(count)")
    .eq("id", opts.documentId)
    .eq("teacher_id", opts.teacherId)
    .maybeSingle();
  if (!doc) throw new Error("not found");
  if (doc.source !== "text") throw new Error("PDF 자료는 재업로드로 수정하세요");
  const oldChunks = (doc.chunks as { count: number }[] | null)?.[0]?.count ?? 0;

  const title = opts.rawText.slice(0, 40);
  const { error: uerr } = await db
    .from("documents")
    .update({ raw_text: opts.rawText, title })
    .eq("id", opts.documentId)
    .eq("teacher_id", opts.teacherId);
  if (uerr) throw uerr;

  const { error: derr } = await db.from("chunks").delete().eq("document_id", opts.documentId);
  if (derr) throw derr;

  const pieces = chunkText(opts.rawText);
  const rows = [];
  for (let i = 0; i < pieces.length; i++) {
    rows.push({
      document_id: opts.documentId,
      teacher_id: opts.teacherId,
      ord: i,
      content: pieces[i],
      embedding: await embed(pieces[i]),
    });
  }
  const { error: cerr } = await db.from("chunks").insert(rows);
  if (cerr) throw cerr;

  await logDocumentEvent({
    teacherId: opts.teacherId, documentId: opts.documentId, action: "deleted",
    title: doc.title, kind: doc.kind, source: doc.source, chunks: oldChunks,
  });
  await logDocumentEvent({
    teacherId: opts.teacherId, documentId: opts.documentId, action: "created",
    title, kind: doc.kind, source: doc.source, chunks: rows.length,
  });

  return { chunks: rows.length };
}

// 감사 로그 기록. 실패해도 본 작업은 막지 않음 (로그 때문에 등록/삭제가 깨지면 안 됨).
export async function logDocumentEvent(e: {
  teacherId: string;
  documentId: string | null;
  action: "created" | "deleted";
  title?: string | null;
  kind?: string | null;
  source?: string | null;
  chunks?: number;
}) {
  try {
    await serviceClient().from("document_events").insert({
      teacher_id: e.teacherId,
      document_id: e.documentId,
      action: e.action,
      title: e.title ?? null,
      kind: e.kind ?? null,
      source: e.source ?? null,
      chunks: e.chunks ?? 0,
    });
  } catch (err) {
    console.error("document_events:", err instanceof Error ? err.message : err);
  }
}
