"use client";
import { useRouter } from "next/navigation";

// 페이지 공통 뒤로가기. 히스토리가 있으면 진짜 뒤로, 직접 진입(새 탭·링크 공유)이면 fallback으로.
export default function BackButton({ fallback = "/", label = "뒤로" }: { fallback?: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
      // 글자는 화면에서 빼고 꺾쇠 아이콘만 — 44px 터치 영역. 스크린리더용 이름은 label 그대로
      aria-label={label}
      title={label}
      className="grid place-items-center w-11 h-11 -ml-3 shrink-0 rounded-[12px] text-text hover:bg-[var(--fill)] transition-colors self-start"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}
