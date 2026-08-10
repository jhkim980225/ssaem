import { serviceClient } from "./supabase";
import { embed } from "./embed";
import { rank } from "./lexical";

export type Hit = { id: string; content: string; kind: string; similarity?: number };

// 말투 자료(kind='style')는 "AI가 어떻게 답할지"를 적은 강사 내부 지시문이다.
// 근거로 쓰이면 학생 화면 '출처'에 그 지시문이 그대로 노출된다 — 검색 대상에서 제외한다.
// (말투는 teacher_profiles.tone_note로 프롬프트에 들어가므로 검색에 안 잡혀도 반영된다.)
const STYLE_MARGIN = 3;
const dropStyle = (hits: Hit[]) => hits.filter((h) => h.kind !== "style");

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
    // 말투 자료를 걸러내면 k개가 안 될 수 있으니 여유분을 더 받아온다
    const { data, error } = await db.rpc("match_chunks", {
      p_teacher: teacherId,
      p_query: vec,
      p_k: k + STYLE_MARGIN,
      p_course: courseId ?? null,
    });
    if (error) throw error;
    return dropStyle((data ?? []) as Hit[]).slice(0, k);
  }

  // 폴백: 강사 청크 전체를 가져와 lexical 스코어로 랭킹 (강좌 필터 — 공용(null) 포함)
  let q = db
    .from("chunks")
    .select("id, content, documents!inner(kind, course_id)")
    .eq("teacher_id", teacherId)
    .limit(500);
  if (courseId)
    q = q.or(`course_id.is.null,course_id.eq.${courseId}`, { referencedTable: "documents" });
  const { data, error } = await q;
  if (error) throw error;

  type Row = { id: string; content: string; documents: { kind: string } | { kind: string }[] };
  const rows: Hit[] = ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    content: r.content,
    kind: Array.isArray(r.documents) ? r.documents[0]?.kind : r.documents?.kind,
  }));
  return rank(question, dropStyle(rows), k);
}
