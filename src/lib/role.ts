// 역할 타입과 순수 판정 함수. 인증 "상태"는 여기 없다 — `lib/auth-store.ts` 한 곳에 있다.
// 예전엔 이 파일에 useSession/useRole이 있었고 컴포넌트마다 각자 상태를 들고 있었다.
// 그래서 페이지를 옮길 때마다 "로그인 여부를 모르는 렌더"가 다시 생겨 화면이 깜빡였다.

export type Role = "teacher" | "student" | "admin" | null;

// /login 역할 탭은 "이 탭으로는 이 역할만"이라는 필터다.
// 역할 판정 근거로는 절대 쓰지 않는다 — 탭을 신뢰하면 권한 상승이 된다.
// 강사 탭이 null을 통과시키는 건 가입 직후(프로필 저장 전) 상태라, 막으면 프로필을 못 만든다.
export function roleFitsTab(tab: "student" | "teacher", role: Role): boolean {
  return tab === "student" ? role === "student" : role === "teacher" || role === null;
}

// 역할별 기본 착지 화면.
// role=null(프로필 없음)은 강사 가입 직후 상태 — 학생·원장은 가입 시 프로필이 생기므로.
// 그래서 프로필 설정 화면인 /teacher로 보낸다.
export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "student") return "/ask";
  return "/teacher";
}
