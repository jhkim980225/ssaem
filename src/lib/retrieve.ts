import { serviceClient } from "./supabase";
import { embed } from "./embed";
import { rank } from "./lexical";

export type Hit = { id: string; content: string; kind: string; similarity?: number };

// 강사 자료(chunks)에서 질문 관련 청크 검색.
// 임베딩 가능하면 벡터 유사도(match_chunks RPC), 아니면 lexical 랭킹 폴백.
export async function retrieve(
  teacherId: string,
  question: string,
  k = 5,
  courseId?: string | null
): Promise<Hit[]> {
  const db = serviceClient();
  const vec = await embed(question);

  if (vec) {
    const { data, error } = await db.rpc("match_chunks", {
      p_teacher: teacherId,
      p_query: vec,
      p_k: k,
      p_course: courseId ?? null,
    });
    if (error) throw error;
    return (data ?? []) as Hit[];
  }

  // 폴백: 강사 청크 전체를 가져와 lexical 스코어로 랭킹
  const { data, error } = await db
    .from("chunks")
    .select("id, content, documents!inner(kind)")
    .eq("teacher_id", teacherId)
    .limit(500);
  if (error) throw error;

  type Row = { id: string; content: string; documents: { kind: string } | { kind: string }[] };
  const rows: Hit[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    content: r.content,
    kind: Array.isArray(r.documents) ? r.documents[0]?.kind : r.documents?.kind,
  }));
  return rank(question, rows, k);
}
