import { serviceClient } from "./supabase";
import { embedMany } from "./embed";
import { chunkText } from "./chunk";
import { hasLlmKey, generateText } from "./anthropic";

// 수업(달력) 자료 AI 요약 — 강사가 중구난방으로 적은 메모를 학생용 2~3문장으로.
// 실패·키 없음이면 null: 요약은 편의 기능이라 업로드를 막으면 안 된다.
export async function summarizeLesson(rawText: string): Promise<string | null> {
  if (!hasLlmKey()) return null;
  try {
    const out = await generateText(
      "학원 강사가 수업 직후 급하게 적은 수업 메모를 학생에게 보여줄 요약으로 정리한다. " +
        "규칙: 한국어 2~3문장, 오늘 배운 핵심 주제·개념 위주, 존댓말(~했어요 톤), 메모에 없는 내용 추가 금지, " +
        "인사말·서두 없이 요약 본문만 출력.",
      [{ role: "user", content: rawText.slice(0, 6000) }],
      300
    );
    const s = out.trim();
    return s ? s.slice(0, 500) : null;
  } catch {
    return null;
  }
}

// 내 강좌인지 확인 — 아니면 null(공용)로 강등. 자료 등록 라우트 공용.
export async function ownCourseOrNull(uid: string, raw: unknown): Promise<string | null> {
  const id = (raw ?? "").toString();
  if (!id) return null;
  const { data } = await serviceClient()
    .from("courses")
    .select("id")
    .eq("id", id)
    .eq("teacher_id", uid)
    .maybeSingle();
  return data?.id ?? null;
}

/** "YYYY-MM-DD"만 통과, 아니면 null — 달력 밖 임의 문자열이 DB로 가지 않게 */
export function lessonDateOrNull(v: unknown): string | null {
  const s = (v ?? "").toString();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// 원본 문서 저장 + 청킹 + 청크별 임베딩. 텍스트/PDF 공용.
export async function saveDocument(opts: {
  teacherId: string;
  kind: "problem" | "style";
  rawText: string;
  title?: string | null;
  source: "text" | "pdf";
  courseId?: string | null;
  lessonDate?: string | null; // YYYY-MM-DD (ROOM 달력)
}): Promise<{ documentId: string; chunks: number }> {
  const db = serviceClient();

  // 달력 수업 자료면 AI 요약을 함께 저장 (키 없거나 실패 시 null — 업로드는 계속)
  const summary = opts.lessonDate ? await summarizeLesson(opts.rawText) : null;

  const { data: doc, error: derr } = await db
    .from("documents")
    .insert({
      teacher_id: opts.teacherId,
      course_id: opts.courseId ?? null,
      lesson_date: opts.lessonDate ?? null,
      kind: opts.kind,
      title: opts.title ?? opts.rawText.slice(0, 40),
      source: opts.source,
      raw_text: opts.rawText,
      summary,
    })
    .select("id")
    .single();
  if (derr) throw derr;

  // 임베딩/청크 저장이 실패하면 방금 만든 문서 행을 되돌린다 —
  // 안 그러면 청크 0개 유령 문서가 남아 무료 플랜 자료 한도만 갉아먹는다.
  let rows: { document_id: string; teacher_id: string; ord: number; content: string; embedding: number[] | null }[];
  try {
    const pieces = chunkText(opts.rawText);
    const vecs = await embedMany(pieces);
    rows = pieces.map((content, i) => ({
      document_id: doc.id,
      teacher_id: opts.teacherId,
      ord: i,
      content,
      embedding: vecs[i],
    }));
    const { error: cerr } = await db.from("chunks").insert(rows);
    if (cerr) throw cerr;
  } catch (e) {
    await db.from("documents").delete().eq("id", doc.id);
    throw e;
  }

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
    .select("id, title, kind, source, lesson_date")
    .eq("id", opts.documentId)
    .eq("teacher_id", opts.teacherId)
    .maybeSingle();
  if (!doc) throw new Error("not found");
  if (doc.source !== "text") throw new Error("PDF 자료는 재업로드로 수정하세요");

  const title = opts.rawText.slice(0, 40);
  // 수업 자료면 요약도 새 내용 기준으로 다시 (실패 시 null로 덮음 — 낡은 요약이 남는 것보다 낫다)
  const summary = doc.lesson_date ? await summarizeLesson(opts.rawText) : null;

  // 재임베딩을 **먼저** 한다. 실패하면(쿼터 등) 여기서 throw하고 기존 원문·청크는 그대로 —
  // 예전엔 청크를 먼저 지운 뒤 재임베딩해서, 실패 시 문서가 검색에서 통째로 사라졌다.
  const pieces = chunkText(opts.rawText);
  const vecs = await embedMany(pieces);
  const rows = pieces.map((content, i) => ({
    document_id: opts.documentId,
    teacher_id: opts.teacherId,
    ord: i,
    content,
    embedding: vecs[i],
  }));

  const { error: uerr } = await db
    .from("documents")
    .update({ raw_text: opts.rawText, title, ...(doc.lesson_date ? { summary } : {}) })
    .eq("id", opts.documentId)
    .eq("teacher_id", opts.teacherId);
  if (uerr) throw uerr;

  const { error: derr } = await db.from("chunks").delete().eq("document_id", opts.documentId);
  if (derr) throw derr;

  const { error: cerr } = await db.from("chunks").insert(rows);
  if (cerr) throw cerr;

  // 수정은 한 건으로 기록한다. 예전엔 deleted+created 쌍으로 남겨서
  // 감사 로그가 "지웠다 새로 올렸다"로 왜곡됐다.
  await logDocumentEvent({
    teacherId: opts.teacherId, documentId: opts.documentId, action: "updated",
    title, kind: doc.kind, source: doc.source, chunks: rows.length,
  });

  return { chunks: rows.length };
}

// 감사 로그 기록. 실패해도 본 작업은 막지 않음 (로그 때문에 등록/삭제가 깨지면 안 됨).
export async function logDocumentEvent(e: {
  teacherId: string;
  documentId: string | null;
  action: "created" | "updated" | "deleted";
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
