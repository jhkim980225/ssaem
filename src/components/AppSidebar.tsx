"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessageCircleQuestion,
  ListChecks,
  BookOpenCheck,
  Search,
  LayoutDashboard,
  Building2,
  CreditCard,
  LogIn,
  LogOut,
  Settings,
  Moon,
  PanelLeftOpen,
  PanelLeftClose,
  Menu,
  X,
} from "lucide-react";
import { SHOW_PRICING } from "@/lib/flags";
import type { Role } from "@/lib/role";
import { useAuth } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";

// 전역 내비 — 아이콘 레일 사이드바 (Celonis식 B2B 대시보드 레이아웃).
//  · 데스크톱(md~): 좌측 고정 68px 아이콘 레일, 토글로 232px 확장(본문 위에 얹혀 레이아웃 안 밀림)
//  · 모바일: 상단 60px 바(햄버거) + 오버레이 드로어 (외부 클릭·ESC·메뉴 선택 시 닫힘)
//  · 확장 상태는 localStorage 유지. 메뉴 구성·권한은 기존 헤더 내비(navFor)와 동일.

const RAIL = 68;
const WIDE = 232;
const LS_KEY = "sidebar-expanded";

type Item = { href: string; label: string; icon: React.ComponentType<{ size?: number | string }> };

// 기존 SiteHeader.navFor와 같은 구성 — 역할에 해당하는 메뉴만 (권한 변경 없음)
function navFor(role: Role | undefined, signedIn: boolean): Item[] {
  const pricing: Item[] = SHOW_PRICING ? [{ href: "/pricing", label: "요금제", icon: CreditCard }] : [];
  if (!signedIn) return [...pricing, { href: "/login", label: "로그인", icon: LogIn }];
  const bank: Item = { href: "/bank", label: "기출문제", icon: BookOpenCheck };
  const browse: Item = { href: "/bank/browse", label: "문제검색", icon: Search };
  if (role === "admin")
    return [...pricing, { href: "/admin", label: "학원장", icon: Building2 }, bank, browse];
  if (role === "teacher" || role === null)
    return [
      ...pricing,
      { href: "/teacher", label: "강사 공간", icon: LayoutDashboard },
      { href: "/ask", label: "질문하기", icon: MessageCircleQuestion },
      bank,
      browse,
    ];
  if (role === "student")
    return [
      ...pricing,
      { href: "/ask", label: "질문하기", icon: MessageCircleQuestion },
      { href: "/quiz", label: "문제풀이", icon: ListChecks },
      bank,
      browse,
    ];
  return pricing;
}

function toggleTheme() {
  const cur =
    document.documentElement.dataset.theme ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
}

// 축소 상태에서 아이콘 옆에 뜨는 툴팁 (스크린 리더는 aria-label을 읽으므로 시각 전용)
function Tip({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[8px] border border-line px-2.5 py-1.5 text-[12px] font-bold opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50"
      style={{ background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-card)" }}
    >
      {label}
    </span>
  );
}

function NavItem({
  item,
  wide,
  active,
  onNav,
}: {
  item: Item;
  wide: boolean;
  active: boolean;
  onNav?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNav}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`group relative flex items-center h-11 rounded-[12px] mx-2 transition-colors outline-none
        focus-visible:ring-2 focus-visible:ring-[var(--blue)]
        ${wide ? "px-3 gap-3" : "justify-center"}
        ${active ? "font-bold" : "hover:bg-[var(--fill)]"}`}
      style={active ? { background: "var(--blue-weak)", color: "var(--blue)" } : { color: "var(--sub)" }}
    >
      {/* 활성 인디케이터 — 배경 + 아이콘색 + 좌측 바 3중 표시 */}
      {active && (
        <span
          aria-hidden
          className="absolute -left-2 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full"
          style={{ background: "var(--blue)" }}
        />
      )}
      <Icon size={21} aria-hidden />
      {wide ? <span className="text-[14px] truncate">{item.label}</span> : <Tip label={item.label} />}
    </Link>
  );
}

function IconBtn({
  label,
  onClick,
  wide,
  children,
}: {
  label: string;
  onClick: () => void;
  wide: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`group relative flex items-center h-11 rounded-[12px] mx-2 transition-colors outline-none
        focus-visible:ring-2 focus-visible:ring-[var(--blue)] hover:bg-[var(--fill)]
        ${wide ? "px-3 gap-3" : "justify-center"} w-[calc(100%-16px)]`}
      style={{ color: "var(--sub)" }}
    >
      {children}
      {wide ? <span className="text-[14px] truncate">{label}</span> : <Tip label={label} />}
    </button>
  );
}

// 레일/드로어 공용 본문 — 로고 · 주요 메뉴 · (설정)테마·로그아웃
function SidebarBody({
  wide,
  settled,
  nav,
  activeHref,
  signedIn,
  showSettings,
  settingsActive,
  onLogout,
  onNav,
}: {
  wide: boolean;
  settled: boolean;
  nav: Item[];
  activeHref: string | undefined;
  signedIn: boolean;
  showSettings: boolean;
  settingsActive: boolean;
  onLogout: () => void;
  onNav?: () => void;
}) {
  return (
    <>
      <Link
        href="/"
        onClick={onNav}
        aria-label="홈으로"
        className={`flex items-center h-[60px] shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)] ${wide ? "px-4 gap-2.5" : "justify-center"}`}
      >
        <span className="grid place-items-center w-9 h-9 rounded-[10px] bg-blue text-white text-[13px] font-extrabold shrink-0">
          마
        </span>
        {wide && <span className="text-[14px] font-extrabold tracking-tight whitespace-nowrap">마스터 전산회계</span>}
      </Link>
      <div className="mx-4 border-t" style={{ borderColor: "var(--line)" }} aria-hidden />

      {/* 메뉴가 많아지면 사이드바 내부만 스크롤 */}
      <nav
        aria-label="주요 메뉴"
        className="flex-1 overflow-y-auto py-3 flex flex-col gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {!settled && (
          <div className={`flex flex-col gap-2 ${wide ? "px-4" : "items-center"}`} aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="skel w-9 h-9 !rounded-[12px]" />
            ))}
          </div>
        )}
        {nav.map((n) => (
          <NavItem key={n.href} item={n} wide={wide} active={n.href === activeHref} onNav={onNav} />
        ))}
      </nav>

      <div className="mx-4 border-t" style={{ borderColor: "var(--line)" }} aria-hidden />
      <div className="py-3 flex flex-col gap-1 shrink-0">
        {showSettings && (
          <NavItem
            item={{ href: "/teacher/settings", label: "개인 설정", icon: Settings }}
            wide={wide}
            active={settingsActive}
            onNav={onNav}
          />
        )}
        <IconBtn label="라이트/다크 전환" onClick={toggleTheme} wide={wide}>
          <Moon size={21} aria-hidden />
        </IconBtn>
        {signedIn && (
          <IconBtn label="로그아웃" onClick={onLogout} wide={wide}>
            <LogOut size={21} aria-hidden />
          </IconBtn>
        )}
      </div>
    </>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { status, role } = useAuth();
  const settled = status !== "loading" && role !== undefined;
  const nav = settled ? navFor(role, status === "signed-in") : [];
  const signedIn = status === "signed-in";

  const [expanded, setExpanded] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // 첫 렌더에서 localStorage 복원 시 확장 애니메이션이 튀지 않게, 마운트 후에만 transition
  const [animate, setAnimate] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장된 확장 상태 1회 복원
      if (localStorage.getItem(LS_KEY) === "1") setExpanded(true);
    } catch {}
    const t = setTimeout(() => setAnimate(true), 50);
    return () => clearTimeout(t);
  }, []);

  function toggleExpand() {
    setExpanded((v) => {
      try {
        localStorage.setItem(LS_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  }

  // 드로어: ESC로 닫기
  useEffect(() => {
    if (!drawer) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [drawer]);

  // 활성: 후보 중 가장 긴 prefix 하나만 (/bank/browse에서 /bank와 동시 활성 방지)
  const activeHref = nav
    .filter((x) => pathname === x.href || pathname.startsWith(x.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  async function logout() {
    await supabase.auth.signOut();
    setDrawer(false);
    router.replace("/login");
  }

  const bodyProps = {
    settled,
    nav,
    activeHref,
    signedIn,
    showSettings: signedIn && (role === "teacher" || role === null),
    settingsActive: pathname === "/teacher/settings",
    onLogout: logout,
  };

  return (
    <>
      {/* 데스크톱·태블릿(md~): 고정 아이콘 레일. 확장은 본문 위에 얹힘 — 레이아웃 안 밀림 */}
      <aside
        className={`hidden md:flex fixed left-0 top-0 bottom-0 z-40 flex-col border-r ${animate ? "transition-[width] duration-200" : ""}`}
        style={{
          width: expanded ? WIDE : RAIL,
          background: "var(--fill-2)",
          borderColor: "var(--line)",
          boxShadow: expanded ? "var(--shadow-card)" : undefined,
        }}
      >
        <SidebarBody wide={expanded} {...bodyProps} />
        <div className="mx-4 border-t" style={{ borderColor: "var(--line)" }} aria-hidden />
        <div className="py-2 shrink-0">
          <IconBtn label={expanded ? "사이드바 접기" : "사이드바 펼치기"} onClick={toggleExpand} wide={expanded}>
            {expanded ? <PanelLeftClose size={21} aria-hidden /> : <PanelLeftOpen size={21} aria-hidden />}
          </IconBtn>
        </div>
      </aside>

      {/* 모바일(<md): 상단 바 + 햄버거. 높이 60px — 기존 sticky 오프셋과 맞춤 */}
      <header
        className="md:hidden sticky top-0 z-40 border-b h-[60px] flex items-center gap-2 px-3"
        style={{
          background: "color-mix(in srgb, var(--surface) 88%, transparent)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderColor: "var(--line)",
        }}
      >
        <button
          onClick={() => setDrawer(true)}
          aria-label="메뉴 열기"
          className="grid place-items-center w-11 h-11 rounded-[12px] hover:bg-[var(--fill)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--blue)]"
          style={{ color: "var(--sub)" }}
        >
          <Menu size={22} aria-hidden />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <span className="grid place-items-center w-8 h-8 rounded-[10px] bg-blue text-white text-[13px] font-extrabold">마</span>
          <span className="text-[14px] font-extrabold tracking-tight">마스터 전산회계 학원</span>
        </Link>
      </header>

      {/* 모바일 드로어 */}
      {drawer && (
        <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="내비게이션 메뉴">
          <button
            aria-label="메뉴 닫기 (배경)"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 w-full h-full"
            style={{ background: "rgba(0,0,0,0.4)" }}
          />
          <div
            className="absolute left-0 top-0 bottom-0 w-[264px] flex flex-col border-r animate-pop"
            style={{ background: "var(--fill-2)", borderColor: "var(--line)" }}
          >
            <button
              onClick={() => setDrawer(false)}
              aria-label="메뉴 닫기"
              className="absolute right-2 top-3 grid place-items-center w-11 h-11 rounded-[12px] hover:bg-[var(--fill)]"
              style={{ color: "var(--sub)" }}
            >
              <X size={20} aria-hidden />
            </button>
            <SidebarBody wide {...bodyProps} onNav={() => setDrawer(false)} />
          </div>
        </div>
      )}
    </>
  );
}
