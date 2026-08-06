// 배포별 기능 토글. NEXT_PUBLIC_*은 빌드 시 인라인 — 서버·클라이언트 컴포넌트 공용.

// 요금제 노출. 파일럿 학원엔 돈 얘기를 띄우지 않으려고 기본 숨김.
// 페이지(/pricing)는 살아 있어 영업 시 직접 링크로 안내 가능.
export const SHOW_PRICING = process.env.NEXT_PUBLIC_SHOW_PRICING === "1";
