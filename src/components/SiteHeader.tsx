"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/ask", label: "질문하기" },
  { href: "/teacher", label: "강사 공간" },
  { href: "/admin", label: "학원장" },
  { href: "/pricing", label: "요금제" },
] as const;

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-40 border-b border-line"
      style={{ background: "color-mix(in srgb, var(--surface) 82%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      <div className="mx-auto w-full max-w-5xl px-5 h-[60px] flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-blue text-white text-[12px] font-extrabold transition-transform group-hover:rotate-[-8deg]">
            AI
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-extrabold tracking-tight">학원 AI 튜터</span>
            <span className="text-[10px] text-sub mt-0.5 hidden sm:block">우리 선생님 자료로 답하는 AI</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`px-2 sm:px-3.5 py-2 rounded-full text-[13px] sm:text-[14px] font-bold whitespace-nowrap transition-colors ${
                  active ? "bg-blue text-white" : "text-sub hover:text-text hover:bg-[var(--fill)]"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
