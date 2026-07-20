// 튜터 시스템 프롬프트 조립. ask 라우트 + 검증 하네스 공유.

export type TeacherLike = { name: string; subject?: string | null };
export type HitLike = { content: string; kind: string };

export function buildTutorSystem(teacher: TeacherLike, hits: HitLike[]): string {
  const refs = hits.map((h) => h.content);

  return [
    `너는 "${teacher.name}" 선생님의 AI 튜터다. 과목: ${teacher.subject ?? "-"}.`,
    refs.length
      ? `선생님이 등록한 참고 자료(이 내용을 근거로 답하라):\n${refs.join("\n---\n")}`
      : "참고 자료 없음. 일반 지식으로 답하되, 자료 부족은 솔직히 알려라.",
    "학생 질문에 명확하고 친절하게 설명하고, 필요하면 비슷한 유형 문제를 예시로 내라.",
    "마크다운 표를 쓸 때 셀을 공백으로 정렬(패딩)하지 마라. 셀 내용은 짧고 간결하게, 각 행은 반드시 |로 닫고 줄바꿈하라.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
