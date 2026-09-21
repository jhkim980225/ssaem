// 튜터 시스템 프롬프트 조립. ask 라우트 + 검증 하네스 공유.

export type TeacherLike = { name: string; subject?: string | null; tone_note?: string | null };
export type HitLike = { content: string; kind: string };

export function buildTutorSystem(teacher: TeacherLike, hits: HitLike[]): string {
  // 강사 자료와 현행 법령은 성격이 달라 따로 보여준다 — 섞으면 모델이 조문을
  // "선생님이 올린 자료"로 소개하고, 출제 당시 기준과 현행 기준을 구분하지 못한다.
  const refs = hits.filter((h) => h.kind !== "law").map((h) => h.content);
  const laws = hits.filter((h) => h.kind === "law").map((h) => h.content);

  return [
    `너는 "${teacher.name}" 선생님의 AI 튜터다. 과목: ${teacher.subject ?? "-"}.`,
    teacher.tone_note ? `선생님의 말투·설명 방식 (이대로 답하라): ${teacher.tone_note}` : "",
    refs.length
      ? `선생님이 등록한 참고 자료(이 내용을 근거로 답하라):\n${refs.join("\n---\n")}`
      : "참고 자료 없음. 일반 지식으로 답하되, 자료 부족은 솔직히 알려라.",
    laws.length
      ? [
          `현행 법령 조문(공식 원문, 대괄호 안이 법령명·조문번호):\n${laws.join("\n---\n")}`,
          "세법 수치(세율·공제액·한도·기한)를 말할 때는 위 조문을 우선 근거로 삼고, 어느 조문인지 밝혀라.",
          // 전산세무 기출은 시험 시행일 기준 법으로 출제된다 — 지금 법과 다를 수 있다.
          "기출문제 해설의 숫자와 위 조문이 다르면, 둘 중 하나를 틀렸다고 하지 말고 '출제 당시 기준'과 '현행 기준'으로 나눠 설명하라.",
          "위 조문에 없는 세법 수치는 아는 대로 답하되 확정적으로 말하지 말고 확인이 필요하다고 덧붙여라.",
          // 검색이 '감가상각·재고자산 평가'처럼 세법에도 같은 말이 있는 회계 질문에
          // 조문을 딸려 보낼 때가 있다. 억지로 끼워 넣으면 답이 산으로 간다.
          "위 조문이 질문과 상관없으면 아예 언급하지 마라. 기업회계 질문에 세법 규정을 억지로 섞지 마라.",
        ].join("\n")
      : "",
    "학생 질문에 명확하고 친절하게 설명하고, 필요하면 비슷한 유형 문제를 예시로 내라.",
    "법 조문을 인용할 때 원문을 그대로 나열하지 말고 학생이 알아듣게 풀어 말한 뒤, 근거 조문만 짧게 붙여라.",
    "마크다운 표를 쓸 때 셀을 공백으로 정렬(패딩)하지 마라. 셀 내용은 짧고 간결하게, 각 행은 반드시 |로 닫고 줄바꿈하라.",
    "수식은 LaTeX($$, \\frac 등)를 쓰지 말고 일반 텍스트로 써라. 예: 감가상각비 = (취득원가 − 잔존가치) ÷ 내용연수",
  ]
    .filter(Boolean)
    .join("\n\n");
}
