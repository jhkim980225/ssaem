"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";

// 강사 영역 공용 사이드바 — 강좌(ROOM) 목록·화면 이동·프로필 진입점.
// PC(lg~)는 좌측 고정 세로 바, 모바일은 상단 가로 스크롤 칩 바로 같은 링크를 보여준다.

/** 강좌·프로필이 바뀐 쪽이 window에 쏘는 이벤트 — 사이드바/대시보드가 서로 다시 불러온다 */
export const TEACHER_REFRESH = "teacher:refresh";

type Course = { id: string; title: string; documents: number };

export default function TeacherSidebar() {
  const { status, role, session } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  const [courses, setCourses] = useState<Course[]>([]);
  const [profile, setProfile] = useState<{ name: string; subject: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const token = session?.access_token;
  // role null = 강사 가입 직후(프로필 저장 전) — 설정으로 가는 길은 열어둔다
  const isTeacher = status === "signed-in" && (role === "teacher" || role === null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [cr, pr] = await Promise.all([
        fetch("/api/courses", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (cr.ok) setCourses((await cr.json()).courses ?? []);
      const pd = await pr.json().catch(() => null);
      if (pr.ok && pd?.profile)
        setProfile({ name: pd.profile.name ?? "", subject: pd.profile.subject ?? "" });
    } catch {
      /* 사이드바는 부가 UI — 실패해도 본문이 알려준다 */
    }
  }, [token]);

  useEffect(() => {
    if (!isTeacher) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async 함수라 setState는 await 이후, 동기 캐스케이드 아님
    load();
    window.addEventListener(TEACHER_REFRESH, load);
    return () => window.removeEventListener(TEACHER_REFRESH, load);
  }, [isTeacher, load]);

  if (!isTeacher) return null;

  async function addCourse() {
    const title = newTitle.trim();
    if (!title || busy || !token) return;
    setBusy(true);
    try {
      const r = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d?.id) {
        setNewTitle("");
        setAdding(false);
        window.dispatchEvent(new Event(TEACHER_REFRESH));
        router.push(`/teacher?room=${d.id}`);
      }
    } finally {
      setBusy(false);
    }
  }

  const room = pathname === "/teacher" ? params.get("room") : undefined;
  const rooms: { key: string; href: string; label: string; count?: number; active: boolean }[] = [
    { key: "all", href: "/teacher", label: "전체 자료", active: room === null },
    { key: "none", href: "/teacher?room=none", label: "공용 자료", active: room === "none" },
    ...courses.map((c) => ({
      key: c.id,
      href: `/teacher?room=${c.id}`,
      label: c.title,
      count: c.documents,
      active: room === c.id,
    })),
  ];
  const pages = [
    { href: "/teacher/insights", label: "인사이트" },
    { href: "/teacher/history", label: "질문 이력" },
    { href: "/teacher/students", label: "학생 리포트" },
    { href: "/teacher/settings", label: "개인 설정" },
  ];

  const itemCls = (active: boolean) =>
    `rounded-[12px] px-3 py-2 text-[14px] text-left transition-colors ${
      active ? "font-bold" : "hover:bg-[var(--fill)]"
    }`;
  const itemStyle = (active: boolean) =>
    active ? { background: "var(--blue-weak)", color: "var(--blue)" } : undefined;

  return (
    <>
      {/* PC — 좌측 고정 */}
      <aside className="hidden lg:flex flex-col gap-1 w-[240px] shrink-0 px-3 py-6 sticky top-0 max-h-screen overflow-y-auto">
        <Link
          href="/teacher/settings"
          className="flex items-center gap-3 rounded-[14px] px-3 py-3 mb-2 hover:bg-[var(--fill)] transition-colors"
        >
          <span
            className="w-10 h-10 rounded-full grid place-items-center font-extrabold text-[16px] shrink-0"
            style={{ background: "var(--blue-weak)", color: "var(--blue)" }}
          >
            {(profile?.name || "?").slice(0, 1)}
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold truncate">{profile?.name || "프로필 설정"}</span>
            <span className="block text-[12px] text-sub truncate">{profile?.subject || "개인 설정 →"}</span>
          </span>
        </Link>

        <p className="text-sub text-[12px] font-bold px-3 mt-1 mb-1">강좌 ROOM</p>
        {rooms.map((r) => (
          <Link key={r.key} href={r.href} className={itemCls(r.active)} style={itemStyle(r.active)}>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{r.label}</span>
              {r.count !== undefined && <span className="text-sub text-[12px] shrink-0">{r.count}</span>}
            </span>
          </Link>
        ))}
        {adding ? (
          <div className="flex gap-1.5 px-1 py-1">
            <input
              autoFocus
              className="field !py-2 !text-[13px] min-w-0"
              placeholder="강좌 이름"
              value={newTitle}
              maxLength={100}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) addCourse();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <button onClick={addCourse} disabled={busy} className="btn btn-primary px-3 !text-[13px] shrink-0">
              추가
            </button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="rounded-[12px] px-3 py-2 text-[13px] text-left text-blue hover:bg-[var(--fill)] transition-colors">
            + 새 강좌 만들기
          </button>
        )}

        <p className="text-sub text-[12px] font-bold px-3 mt-4 mb-1">메뉴</p>
        {pages.map((p) => (
          <Link key={p.href} href={p.href} className={itemCls(pathname === p.href)} style={itemStyle(pathname === p.href)}>
            {p.label}
          </Link>
        ))}
        <button
          onClick={() => supabase.auth.signOut()}
          className="rounded-[12px] px-3 py-2 text-[14px] text-left text-sub hover:bg-[var(--fill)] transition-colors mt-2"
        >
          로그아웃
        </button>
      </aside>

      {/* 모바일 — 상단 가로 스크롤 칩. 같은 링크를 좁은 화면에서도 한 줄로 */}
      <div className="lg:hidden sticky top-[60px] z-30 border-b border-line overflow-x-auto" style={{ background: "var(--surface)" }}>
        <div className="flex gap-1.5 px-4 py-2 w-max">
          {[...rooms, ...pages.map((p) => ({ key: p.href, href: p.href, label: p.label, count: undefined, active: pathname === p.href }))].map((r) => (
            <Link key={r.key} href={r.href} className="chip !text-[13px] whitespace-nowrap" style={itemStyle(r.active)}>
              {r.label}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
