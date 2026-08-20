"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SHOW_PRICING } from "@/lib/flags";
import type { Role } from "@/lib/role";
import { useAuth } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

// 내 역할에 해당하는 링크만 보여준다. 전부 깔면 좁은 화면에서 잘리고, 원장에게
// "강사 공간"을 보여줘 봐야 눌러도 거부 화면만 나온다.
function navFor(role: Role | undefined, signedIn: boolean) {
  const pricing = SHOW_PRICING ? [{ href: "/pricing", label: "요금제" }] : [];
  if (!signedIn) return [...pricing, { href: "/login", label: "로그인" }];
  // 기출문제는 전역 공용(학원·강사 무관)이라 전 역할에 노출. 좁은 화면에선 내비가 가로 스크롤된다.
  const bank = { href: "/bank", label: "기출문제" };
  const browse = { href: "/bank/browse", label: "문제검색" };
  if (role === "admin") return [...pricing, { href: "/admin", label: "학원장" }, bank, browse];
  if (role === "teacher" || role === null)
    return [...pricing, { href: "/teacher", label: "강사 공간" }, { href: "/ask", label: "질문하기" }, bank, browse];
  if (role === "student")
    return [...pricing, { href: "/ask", label: "질문하기" }, { href: "/quiz", label: "문제풀이" }, bank, browse, { href: "/my", label: "마이" }];
  return pricing; // 역할 조회 중 — 확정되면 채운다
}

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, role } = useAuth();
  // 확정 전에 비로그인 내비("로그인")를 그리면, 로그인한 사용자에게 로그인 버튼이 한 번
  // 번쩍이고 → 빈 내비 → 역할 메뉴로 두 번 바뀐다. 확정될 때까지는 자리만 잡아둔다.
  const settled = status !== "loading" && role !== undefined;
  const nav = settled ? navFor(role, status === "signed-in") : [];

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
          {/* 375px에서 로고+내비+테마+로그아웃을 다 넣으면 넘친다.
              아주 좁은 화면에선 배지(마)만 남기고 이름은 접는다 — 로그아웃이 잘리면 안 되므로. */}
          <span className="hidden min-[420px]:inline text-[14px] sm:text-[15px] font-extrabold tracking-tight whitespace-nowrap">
            마스터 전산회계 학원
          </span>
        </Link>

        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
        {/* 좁은 화면에선 내비가 가로 스크롤 — 페이지 전체가 밀려나지 않게 */}
        <nav className="flex items-center gap-0.5 sm:gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!settled && (
            // 폭을 실제 내비와 비슷하게 잡아 확정될 때 레이아웃이 밀리지 않게 한다
            <span className="skel h-7 w-[132px] sm:w-[150px] !rounded-full" aria-hidden />
          )}
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

        {/* 테마 토글·로그아웃은 스크롤 영역 **밖**에 둔다. 안에 넣으면 좁은 화면에서
            스크롤에 밀려 사라진다 — 공용 PC에서 로그아웃 못 하는 사고 방지. */}
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

        {status === "signed-in" && (
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            aria-label="로그아웃"
            title="로그아웃"
            className="grid place-items-center w-8 h-8 shrink-0 rounded-full text-sub hover:text-text hover:bg-[var(--fill)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 17v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path d="M11 12h10m0 0-3-3m3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        </div>
      </div>
    </header>
  );
}
