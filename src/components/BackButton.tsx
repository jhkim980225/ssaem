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
      className="text-sub text-[13px] hover:text-blue transition-colors self-start"
    >
      ← {label}
    </button>
  );
}
