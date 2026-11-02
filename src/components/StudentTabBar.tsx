"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-store";

// 학생 폰 화면 하단 탭바. 헤더 내비는 좁은 화면에서 가로 스크롤돼 메뉴 절반이 안 보였다 —
// 학생은 거의 폰으로 쓰므로 앱처럼 아래 5칸으로 고정한다. lg 이상은 헤더 내비 그대로.
const TABS = [
  { href: "/ask", label: "질문하기", icon: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" },
  { href: "/quiz", label: "문제풀이", icon: "M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4zM8.5 12l2.5 2.5 4.5-5" },
  { href: "/bank", label: "기출문제", icon: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5" },
  { href: "/bank/browse", label: "문제검색", icon: "M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5" },
  { href: "/my", label: "마이", icon: "M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0" },
];

export function useStudentTabs() {
  const { status, role } = useAuth();
  return status === "signed-in" && role === "student";
}

export default function StudentTabBar() {
  const pathname = usePathname();
  if (!useStudentTabs()) return null;
  // /bank/browse 에서 "기출문제"(/bank)까지 켜지지 않게 가장 긴 일치 하나만 활성
  const active = TABS.filter((t) => pathname === t.href || pathname.startsWith(t.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
    {/* 고정 탭바에 마지막 내용이 가려지지 않게 높이만큼 비워둔다 */}
    <div className="lg:hidden h-[68px]" aria-hidden />
    <nav
      aria-label="메인 메뉴"
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map((t) => {
        const on = active === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center gap-1 pt-2 pb-2.5 text-[11px] ${on ? "text-text font-bold" : "text-sub font-semibold"}`}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
    </>
  );
}
