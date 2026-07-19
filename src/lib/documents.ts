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
