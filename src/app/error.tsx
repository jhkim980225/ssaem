"use client";
import { useEffect } from "react";
import Link from "next/link";

// 페이지 런타임 에러 바운더리 — 화면이 하얗게 죽는 대신 복구 버튼을 준다.
// (API 4xx/5xx는 각 화면이 안내 문구로 처리하고, 여기는 렌더 중 예외가 새어 나온 경우)
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("page error boundary:", error);
  }, [error]);

  return (
    <main className="flex-1 grid place-items-center px-5 py-16">
      <div className="card p-8 text-center max-w-sm w-full">
        <p className="text-[40px]">⚠️</p>
        <p className="font-bold text-[16px] mt-1">화면을 그리다 문제가 생겼어요</p>
        <p className="text-sub text-[14px] mt-1.5 leading-relaxed">
          일시적인 오류일 수 있어요. 다시 시도해 보고, 계속되면 새로고침해 주세요.
        </p>
        {error.digest && <p className="text-sub text-[11px] mt-2">오류 코드: {error.digest}</p>}
        <div className="flex flex-col gap-2 mt-5">
          <button onClick={reset} className="btn btn-primary py-3">
            다시 시도
          </button>
          <Link href="/" className="btn btn-gray py-3">
            홈으로 가기
          </Link>
        </div>
      </div>
    </main>
  );
}
