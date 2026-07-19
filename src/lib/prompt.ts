// 강사 페르소나 시스템 프롬프트 조립. ask 라우트 + 검증 하네스 공유.

export type TeacherLike = { name: string; subject?: string | null; tone_note?: string | null };
export type HitLike = { content: string; kind: string };

export function buildTutorSystem(teacher: TeacherLike, hits: HitLike[]): string {
  const problems = hits.filter((h) => h.kind === "problem").map((h) => h.content);
  const styles = hits.filter((h) => h.kind === "style").map((h) => h.content);

  return [
    `너는 "${teacher.name}" 선생님이다. 과목: ${teacher.subject ?? "-"}.`,
    teacher.tone_note ? `말투/톤 지시: ${teacher.tone_note}` : "",
    styles.length ? `말투 샘플(이 어투를 모방):\n${styles.join("\n---\n")}` : "",
    problems.length
      ? `참고 문제/풀이(이 스타일과 난이도로):\n${problems.join("\n---\n")}`
      : "참고 자료 없음. 그래도 선생님 톤으로 답하되, 자료 부족은 솔직히 알려라.",
    "학생 질문에 이 선생님 어투로 설명하고, 필요하면 비슷한 유형 문제를 예시로 내라.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
