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
  /** 초기 비밀번호(휴대폰 뒷자리) 상태 — true면 바꾸기 전까지 앱을 못 쓴다 */
  mustChangePassword?: boolean;
};

// 로그인 지속 상한. Supabase 세션 자체는 만료가 없어(refresh token 무기한) 브라우저를
// 안 지우면 영원히 로그인 상태다. 학원 공용 PC를 생각하면 그건 곤란하다.
//
// ponytail: 브라우저에서 거는 상한이라 우회 가능하다. 서버 강제는 Supabase 대시보드의
// Authentication → Sessions → Time-box user sessions(168h). 그쪽이 진짜 방어선이고
// 여기는 "공용 PC에 방치된 세션"을 끊는 용도다. 대시보드 설정이 켜지면 이 코드는 있어도 무해.
const MAX_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const STARTED_KEY = "ssaem.session-started";

/** 이 세션이 7일을 넘겼는지. 처음 보는 계정이면 지금을 시작 시각으로 기록한다. */
function sessionExpired(uid: string): boolean {
  try {
    const raw = localStorage.getItem(STARTED_KEY);
    const rec = raw ? (JSON.parse(raw) as { uid?: string; at?: number }) : null;
    // 토큰 갱신(1시간마다)으로는 시작 시각을 갱신하지 않는다 — 그래야 "절대 7일"이 된다
    if (rec?.uid !== uid || typeof rec.at !== "number") {
      localStorage.setItem(STARTED_KEY, JSON.stringify({ uid, at: Date.now() }));
      return false;
    }
    return Date.now() - rec.at > MAX_SESSION_MS;
  } catch {
    return false; // 스토리지를 못 쓰면 막지 않는다 (기능이 죽는 것보다 낫다)
  }
}

function clearStarted() {
  try {
    localStorage.removeItem(STARTED_KEY);
  } catch {}
}

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
    next.role === snapshot.role &&
    next.mustChangePassword === snapshot.mustChangePassword
  )
    return;
  snapshot = next;
  for (const l of listeners) l();
}

/** 401 = 인증 실패. 200 + profile:null(강사 가입 직후)과 반드시 구분해야 한다. */
export type RoleResult = Role | "unauthorized";

/** 마지막 조회에서 받은 비밀번호 변경 필요 여부 (역할과 같은 요청으로 함께 온다) */
let lastMustChange = false;

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
  lastMustChange = d?.profile?.mustChangePassword === true;
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
    clearStarted();
    emit(SIGNED_OUT);
    return;
  }
  // 7일 상한. 토큰 갱신 때마다 이 경로를 지나므로 늦어도 1시간 안에 걸린다.
  if (sessionExpired(session.user.id)) {
    inflight = null;
    clearStarted();
    emit(SIGNED_OUT);
    supabase.auth.signOut();
    return;
  }
  const sameUser = snapshot.session?.user.id === session.user.id;
  // 토큰 갱신(TOKEN_REFRESHED)은 세션 객체만 바뀔 뿐 사람은 그대로다 → 역할을 다시 묻지 않는다.
  const role = sameUser ? snapshot.role : undefined;
  emit({
    status: "signed-in",
    session,
    role,
    mustChangePassword: sameUser ? snapshot.mustChangePassword : undefined,
  });
  if (role !== undefined) return;

  ensureRole(session).then((r) => {
    if (snapshot.session?.user.id !== session.user.id) return; // 그 사이 계정이 바뀜
    if (r === "unauthorized") {
      // 토큰이 죽었다. SIGNED_OUT 이벤트가 스토어를 정리한다.
      supabase.auth.signOut();
      return;
    }
    emit({ status: "signed-in", session: snapshot.session, role: r, mustChangePassword: lastMustChange });
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

/** 비밀번호를 바꾼 뒤 호출 — 강제 화면을 즉시 내린다 (재로그인 없이) */
export function clearMustChangePassword() {
  lastMustChange = false;
  if (snapshot.mustChangePassword) emit({ ...snapshot, mustChangePassword: false });
}

export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
