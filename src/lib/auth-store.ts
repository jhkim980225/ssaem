"use client";
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { Role } from "@/lib/role";

// 인증 상태 단일 스토어 (탭당 1개).
//
// 왜 모듈 스코프인가:
// 예전엔 `useSession`이 컴포넌트 인스턴스별 useState였다. 그래서 페이지를 옮길 때마다
// 새 인스턴스가 `{session:null, ready:false}`에서 출발했고, getSession()이 비동기라
// "로그인 여부를 모르는 렌더"가 DOM에 커밋된 뒤에야 세션이 채워졌다.
// 결과: 이동할 때마다 본문에 로딩 스켈레톤이 한 번 그려지고, 헤더는 로그인한 사용자에게
// "로그인" 버튼 → 빈 내비 → 역할 메뉴로 두 번 바뀌었다.
//
// 스토어를 모듈 스코프에 두면 라우트 이동으로 초기화되지 않으므로, 한 번 확정된 뒤에는
// 어떤 컴포넌트가 새로 마운트돼도 첫 렌더부터 확정된 값을 동기로 읽는다.

export type AuthStatus = "loading" | "signed-out" | "signed-in";

export type AuthSnapshot = {
  status: AuthStatus;
  session: Session | null;
  /** undefined = 역할 조회 중, null = 프로필 없음(강사 가입 직후) */
  role: Role | undefined;
};

const SIGNED_OUT: AuthSnapshot = { status: "signed-out", session: null, role: null };
const LOADING: AuthSnapshot = { status: "loading", session: null, role: undefined };

let snapshot: AuthSnapshot = LOADING;
let started = false;
const listeners = new Set<() => void>();

function emit(next: AuthSnapshot) {
  // 참조가 같으면 useSyncExternalStore가 리렌더를 건너뛴다 → 불필요한 렌더 방지
  if (
    next.status === snapshot.status &&
    next.session === snapshot.session &&
    next.role === snapshot.role
  )
    return;
  snapshot = next;
  for (const l of listeners) l();
}

/** 401 = 인증 실패. 200 + profile:null(강사 가입 직후)과 반드시 구분해야 한다. */
export type RoleResult = Role | "unauthorized";

// 진행 중인 조회를 uid별로 공유한다. 로그인 직후엔 onAuthStateChange(스토어)와
// /login 화면이 거의 동시에 역할을 필요로 하는데, 각자 부르면 /api/profile이 2번 나간다.
let inflight: { uid: string; p: Promise<RoleResult> } | null = null;

async function fetchRole(session: Session): Promise<RoleResult> {
  const r = await fetch("/api/profile", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  }).catch(() => null);
  if (!r) return null; // 네트워크 실패 — 권한 없음으로 본다
  if (r.status === 401) return "unauthorized";
  const d = await r.json().catch(() => null);
  return (d?.profile?.role as Role) ?? null;
}

/**
 * 이 세션의 역할. 같은 uid로 이미 조회 중이면 그 요청을 함께 기다린다.
 * 스토어와 /login이 같은 요청 하나를 쓰게 하는 것이 목적.
 */
export function ensureRole(session: Session): Promise<RoleResult> {
  const uid = session.user.id;
  if (inflight?.uid === uid) return inflight.p;
  const p = fetchRole(session).finally(() => {
    if (inflight?.uid === uid) inflight = null;
  });
  inflight = { uid, p };
  return p;
}

function applySession(session: Session | null) {
  if (!session) {
    inflight = null;
    emit(SIGNED_OUT);
    return;
  }
  const sameUser = snapshot.session?.user.id === session.user.id;
  // 토큰 갱신(TOKEN_REFRESHED)은 세션 객체만 바뀔 뿐 사람은 그대로다 → 역할을 다시 묻지 않는다.
  const role = sameUser ? snapshot.role : undefined;
  emit({ status: "signed-in", session, role });
  if (role !== undefined) return;

  ensureRole(session).then((r) => {
    if (snapshot.session?.user.id !== session.user.id) return; // 그 사이 계정이 바뀜
    if (r === "unauthorized") {
      // 토큰이 죽었다. SIGNED_OUT 이벤트가 스토어를 정리한다.
      supabase.auth.signOut();
      return;
    }
    emit({ status: "signed-in", session: snapshot.session, role: r });
  });
}

function start() {
  if (started) return;
  started = true;
  supabase.auth.getSession().then(({ data }) => applySession(data.session));
  supabase.auth.onAuthStateChange((_e, s) => applySession(s));
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const getSnapshot = () => snapshot;
// 서버 렌더와 하이드레이션 첫 렌더는 항상 loading — 여기서 갈리면 hydration 불일치가 난다.
const getServerSnapshot = () => LOADING;

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
