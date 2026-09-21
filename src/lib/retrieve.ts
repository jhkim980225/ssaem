import { serviceClient } from "./supabase";
import { embed } from "./embed";
import { rank } from "./lexical";

export type Hit = { id: string; content: string; kind: string; similarity?: number };

// 말투 자료(kind='style')는 "AI가 어떻게 답할지"를 적은 강사 내부 지시문이다.
// 근거로 쓰이면 학생 화면 '출처'에 그 지시문이 그대로 노출된다 — 검색 대상에서 제외한다.
// (말투는 teacher_profiles.tone_note로 프롬프트에 들어가므로 검색에 안 잡혀도 반영된다.)
const STYLE_MARGIN = 3;
const dropStyle = (hits: Hit[]) => hits.filter((h) => h.kind !== "style");

// 공용 참고자료(현행 법령, teacher_id NULL)에서 함께 가져올 개수.
// 강사 자료와 같은 순위표에 섞지 않는다 — 소득세 질문 하나에 조문이 상위를 다 차지하면
// 정작 그 선생님 자료가 밀려난다. 정해진 몫만 뒤에 붙인다.
const LAW_K = 2;
// 무관한 조문을 걸러내는 최소 유사도. 한국어 임베딩은 바닥 유사도가 높아서(무관한
// 질문도 0.5대가 나온다) 값을 감으로 잡으면 안 된다 — 질문 33개로 실측해 고른 값:
//   세법 14개 min 0.690 · 회계 15개 중앙 0.648(max 0.741) · 무관 4개 max 0.561
//   0.68 → 세법 14/14 통과, 무관 0/4, 회계 6/15 딸려옴
// 세법 질문을 놓치는 쪽이 더 나쁘므로 재현율을 택했다. 딸려오는 회계 질문은 대부분
// "감가상각·재고자산 평가"처럼 세법에도 같은 주제가 있는 경우고, 프롬프트에서
// "무관하면 언급하지 말라"고 못박아 비용을 토큰만으로 묶는다.
const LAW_MIN_SIM = 0.68;

// 강사 자료(chunks)에서 질문 관련 청크 검색.
// 임베딩 가능하면 벡터 유사도(match_chunks RPC), 아니면 lexical 랭킹 폴백.
export async function retrieve(
  teacherId: string,
  question: string,
  k = 5,
  courseId?: string | null
): Promise<Hit[]> {
  const db = serviceClient();
  // 임베딩 호출 실패(예: Gemini 무료티어 일일 쿼터 429)는 키 부재와 똑같이 취급 →
  // 벡터 검색을 건너뛰고 lexical 폴백을 탄다. 안 잡으면 /api/ask 전체가 500 났다.
  const vec = await embed(question).catch((e) => {
    console.error("embed:", e instanceof Error ? e.message : e);
    return null;
  });

  if (vec) {
    // 말투 자료를 걸러내면 k개가 안 될 수 있으니 여유분을 더 받아온다
    const [own, law] = await Promise.all([
      db.rpc("match_chunks", {
        p_teacher: teacherId,
        p_query: vec,
        p_k: k + STYLE_MARGIN,
        p_course: courseId ?? null,
      }),
      // 법령이 아직 안 깔린 환경(함수 없음)에서도 답변은 나가야 한다 — 실패는 무시
      db.rpc("match_reference_chunks", { p_query: vec, p_k: LAW_K }),
    ]);
    if (own.error) throw own.error;
    if (law.error) console.error("reference chunks:", law.error.message);
    const hits = dropStyle((own.data ?? []) as Hit[]).slice(0, k);
    const laws = ((law.data ?? []) as Hit[]).filter((h) => (h.similarity ?? 0) >= LAW_MIN_SIM);
    return [...hits, ...laws];
  }

  // 폴백: 강사 청크 전체를 가져와 lexical 스코어로 랭킹 (강좌 필터 — 공용(null) 포함).
  // 법령 청크(teacher_id NULL)는 수백 개라 여기 섞으면 키워드 랭킹을 뒤덮는다 —
  // 임베딩이 없는 상황에서는 강사 자료만 쓴다.
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
