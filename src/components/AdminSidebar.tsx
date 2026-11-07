"use client";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// 학원장 화면 사이드바 — 강사 사이드바(TeacherSidebar)와 같은 모양.
// PC(lg~)는 좌측 고정 세로 바, 모바일은 상단 가로 스크롤 칩 바로 같은 메뉴를 보여준다.
// 데이터는 대시보드가 이미 불러온 것을 받아 숫자만 단다 (따로 조회하지 않는다).

export type AdminView = "overview" | "students" | "teachers" | "low-rated" | "reviews" | "assessments" | "invite";

export type AdminNavItem = { view: AdminView; label: string; count?: number | string; warn?: boolean };

export default function AdminSidebar({
  academy,
  admin,
  items,
  current,
}: {
  academy: string;
  admin: string;
  items: AdminNavItem[];
  current: AdminView;
}) {
  const href = (v: AdminView) => (v === "overview" ? "/admin" : `/admin?v=${v}`);

  const itemCls = (active: boolean) =>
    `block rounded-[8px] px-3 py-2.5 text-[15px] text-left transition-colors ${
      active ? "font-bold" : "hover:bg-[var(--fill-2)]"
    }`;
  const itemStyle = (active: boolean) =>
    active ? { background: "var(--blue-weak)", color: "var(--blue)" } : { color: "var(--text-2)" };

  return (
    <>
      {/* PC — 좌측 고정 흰 패널 */}
      <aside
        className="hidden lg:flex flex-col gap-4 w-[260px] shrink-0 px-4 py-5 sticky top-[60px] h-[calc(100vh-60px)] overflow-y-auto border-r border-line"
        style={{ background: "var(--surface)" }}
      >
        <div className="flex items-center gap-3 rounded-[12px] p-3.5" style={{ background: "var(--fill-2)" }}>
          <span className="w-10 h-10 rounded-full grid place-items-center font-bold text-[16px] shrink-0 bg-blue text-white">
            {(academy || "?").slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-bold truncate">{academy}</span>
            <span className="block text-[13px] text-sub truncate">{admin} 원장</span>
          </span>
        </div>

        <nav aria-label="학원장 메뉴" className="flex flex-col gap-0.5">
          <p className="text-sub text-[12px] font-bold px-2 mb-1.5">메뉴</p>
          {items.map((it) => {
            const active = it.view === current;
            return (
              <Link
                key={it.view}
                href={href(it.view)}
                aria-current={active ? "page" : undefined}
                className={itemCls(active)}
                style={itemStyle(active)}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate">{it.label}</span>
                  {it.count !== undefined && (
                    <span
                      className={`text-[13px] font-normal shrink-0 tabular-nums ${active ? "" : "text-sub"}`}
                      style={it.warn && !active ? { color: "var(--red)" } : undefined}
                    >
                      {it.count}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
          <button
            onClick={() => supabase.auth.signOut()}
            className="rounded-[8px] px-3 py-2.5 text-[15px] text-left text-sub hover:bg-[var(--fill-2)] transition-colors mt-2"
          >
            로그아웃
          </button>
        </nav>
      </aside>

      {/* 모바일 — 상단 가로 스크롤 칩 */}
      <nav aria-label="학원장 메뉴" className="lg:hidden sticky top-[60px] z-30 overflow-x-auto" style={{ background: "var(--bg)" }}>
        <div className="flex gap-1.5 px-4 py-2.5 w-max">
          {items.map((it) => {
            const active = it.view === current;
            return (
              <Link
                key={it.view}
                href={href(it.view)}
                aria-current={active ? "page" : undefined}
                className={`chip !text-[14px] whitespace-nowrap ${active ? "chip-on font-bold" : ""}`}
              >
                {it.label}
                {it.warn && !active && (
                  <span aria-hidden="true" className="ml-1 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ background: "var(--red)" }} />
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
