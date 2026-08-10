"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, useRole, homeFor } from "@/lib/role";

// 랜딩은 당분간 숨김 — 첫 진입은 바로 로그인.
// 원래 랜딩은 `src/app/_landing/Landing.tsx`에 그대로 있다 (`_` 폴더는 라우팅에서 제외됨).
// 되살리려면 그 파일을 이 자리로 되돌리면 된다.
export default function Home() {
  const router = useRouter();
  const { session, ready } = useSession();
  const role = useRole(session);

  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/login");
    else if (role !== undefined) router.replace(homeFor(role)); // 로그인 상태면 내 화면으로
  }, [ready, session, role, router]);

  return (
    <main className="flex-1 grid place-items-center">
      <div className="skel w-12 h-12 !rounded-full" />
    </main>
  );
}
