"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHOW_PRICING } from "@/lib/flags";
import { useSession, useRole, type Role } from "@/lib/role";

// 내 역할에 해당하는 링크만 보여준다. 전부 깔면 좁은 화면에서 잘리고, 원장에게
// "강사 공간"을 보여줘 봐야 눌러도 거부 화면만 나온다.
function navFor(role: Role | undefined, signedIn: boolean) {
  const pricing = SHOW_PRICING ? [{ href: "/pricing", label: "요금제" }] : [];
  if (!signedIn) return [...pricing, { href: "/login", label: "로그인" }];
  if (role === "admin") return [...pricing, { href: "/admin", label: "학원장" }];
  if (role === "teacher" || role === null)
    return [...pricing, { href: "/teacher", label: "강사 공간" }, { href: "/ask", label: "질문하기" }];
  // 375px에 로고까지 얹으면 3개부터 화면 밖으로 밀린다. 오답노트는 /quiz 안에서 간다.
  if (role === "student")
    return [...pricing, { href: "/ask", label: "질문하기" }, { href: "/quiz", label: "문제풀이" }];
  return pricing; // 역할 조회 중 — 확정되면 채운다
}

export default function SiteHeader() {
  const pathname = usePathname();
  const { session } = useSession();
  const role = useRole(session);
  const nav = navFor(role, Boolean(session));

  return (
    <header
      className="sticky top-0 z-40 border-b border-line"
      style={{ background: "color-mix(in srgb, var(--surface) 82%, transparent)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
    >
      <div className="mx-auto w-full max-w-[1600px] px-5 lg:px-8 h-[60px] flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0 group">
          <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-blue text-white text-[13px] font-extrabold transition-transform group-hover:rotate-[-8deg]">
            마
          </span>
          <span className="text-[14px] sm:text-[15px] font-extrabold tracking-tight whitespace-nowrap">
            마스터 전산회계 학원
          </span>
        </Link>

        {/* 좁은 화면에선 내비가 가로 스크롤 — 페이지 전체가 밀려나지 않게 */}
        <nav className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => {
              const cur =
                document.documentElement.dataset.theme ||
                (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
              const next = cur === "dark" ? "light" : "dark";
              document.documentElement.dataset.theme = next;
              try {
                localStorage.setItem("theme", next);
              } catch {}
            }}
            aria-label="테마 전환"
            title="라이트/다크 전환"
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full text-sub hover:text-text hover:bg-[var(--fill)] transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.5 5.5 0 0 1-7.54-7.54C12.92 3.04 12.46 3 12 3Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {nav.map((n) => {
            // prefix로만 보면 /quiz/notes에서 "문제풀이"와 "오답노트"가 동시에 켜진다.
            // 후보 중 가장 긴 것 하나만 활성으로 본다.
            const match = nav
              .filter((x) => pathname === x.href || pathname.startsWith(x.href + "/"))
              .sort((a, b) => b.href.length - a.href.length)[0];
            const active = match?.href === n.href;
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
