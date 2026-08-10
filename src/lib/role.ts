"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";

export type Role = "teacher" | "student" | "admin" | null;

// uid → role. 페이지를 옮길 때마다 /api/profile을 다시 부르면 이동이 눈에 띄게 느려진다.
// 탭을 새로 열면 비므로 stale 위험은 세션 1회 수준 — 서버가 어차피 401/403으로 최종 판정한다.
const roleCache = new Map<string, Role>();

// 로그인 사용자의 실제 role. 서버(profiles)가 유일한 진실 — 로그인 탭에서 뭘 골랐는지와 무관.
// null = 프로필 없음(강사 가입 직후), undefined = 아직 조회 중.
//
// 주의: 예전엔 useState 초기값을 `session ? undefined : null`로 줬는데, useState 초기화는
// 첫 렌더에서 한 번만 실행되고 그때 session은 항상 null이라 role이 null로 굳었다.
// 그 결과 "조회 중" 상태가 사라져 가드가 뚫리고 강사 화면이 잠깐 보였다.
export function useRole(session: Session | null): Role | undefined {
  // uid를 함께 들고 있어야 계정이 바뀐 직후 이전 사용자의 role을 잠깐 쓰는 일이 없다
  const [fetched, setFetched] = useState<{ uid: string; role: Role } | null>(null);

  useEffect(() => {
    if (!session) return;
    const uid = session.user.id;
    let alive = true;
    fetch("/api/profile", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => {
        const next = (d.profile?.role as Role) ?? null;
        roleCache.set(uid, next);
        if (alive) setFetched({ uid, role: next });
      })
      .catch(() => {
        // 네트워크 실패로 캐시 값을 지우지는 않는다. 캐시도 없으면 권한 없음으로 본다.
        if (alive && !roleCache.has(uid)) setFetched({ uid, role: null });
      });
    return () => {
      alive = false;
    };
  }, [session]);

  // 렌더 중 계산 — 캐시가 있으면 조회를 기다리지 않고 바로 확정한다 (페이지 이동 체감 속도)
  if (!session) return null;
  const uid = session.user.id;
  if (fetched?.uid === uid) return fetched.role;
  const cached = roleCache.get(uid);
  return cached !== undefined ? cached : undefined;
}

// 역할별 기본 착지 화면.
// role=null(프로필 없음)은 강사 가입 직후 상태 — 학생·원장은 가입 시 프로필이 생기므로.
// 그래서 프로필 설정 화면인 /teacher로 보낸다.
export function homeFor(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "student") return "/ask";
  return "/teacher";
}
