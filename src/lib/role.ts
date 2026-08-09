"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

export type Role = "teacher" | "student" | "admin" | null;

// 로그인 사용자의 실제 role. 서버(profiles)가 유일한 진실 — 로그인 탭에서 뭘 골랐는지와 무관.
// null = 프로필 없음(강사 가입 직후), undefined = 아직 조회 중.
export function useRole(session: Session | null): Role | undefined {
  const [role, setRole] = useState<Role | undefined>(session ? undefined : null);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetch("/api/profile", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setRole((d.profile?.role as Role) ?? null);
      })
      .catch(() => {
        if (alive) setRole(null);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  return session ? role : null;
}

// 역할별 기본 착지 화면.
// role=null(프로필 없음)은 강사 가입 직후 상태 — 학생·원장은 가입 시 프로필이 생기므로.
// 그래서 프로필 설정 화면인 /teacher로 보낸다.
export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "student") return "/ask";
  return "/teacher";
}
