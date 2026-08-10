"use client";
import { type ReactNode } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useSession, useRole, homeFor, type Role } from "@/lib/role";

const LABEL: Record<"teacher" | "admin" | "student", string> = {
  teacher: "강사",
  admin: "학원장",
  student: "학생",
};

// 보호 페이지 공통 게이트. 페이지마다 세션 구독 + 4줄짜리 가드를 복붙하던 걸 한곳으로 모았다
// (그 복붙이 갈라지면서 학생에게 강사 화면이 잠깐 보이는 버그가 났다).
//
//   const { session, gate } = useGate("teacher");
//   if (gate) return gate;   // 여기서 아래는 항상 권한이 확정된 상태
//
// need="any" = 로그인만 필요(역할 무관). allowNoProfile = 강사 가입 직후(프로필 저장 전) 허용.
export function useGate(
  need: "teacher" | "admin" | "student" | "any",
  opts: {
    allowNoProfile?: boolean;
    loginAs?: "teacher" | "student";
    loginMessage?: string;
    /** 비로그인일 때 기본 안내 대신 그릴 것 (원장 가입 폼처럼 그 페이지에만 있는 진입로) */
    loginRender?: ReactNode;
  } = {}
): { session: Session | null; role: Role | undefined; gate: ReactNode | null; allowed: boolean } {
  const { session, ready } = useSession();
  const role = useRole(session);

  const loginAs = opts.loginAs ?? (need === "teacher" || need === "admin" ? "teacher" : "student");

  let gate: ReactNode | null = null;
  if (!ready) gate = <RoleLoading />;
  else if (!session)
    gate = opts.loginRender ?? <NeedLogin as={loginAs} message={opts.loginMessage} />;
  else if (role === undefined) gate = <RoleLoading />; // 역할 확정 전엔 아무것도 그리지 않는다
  else if (need !== "any" && role !== need && !(role === null && opts.allowNoProfile))
    gate = <WrongRole need={need} role={role} />;

  // 데이터 페치 이펙트는 이걸 보고 돌아야 한다. session만 보면 권한 없는 사용자도 요청을 쏴서
  // 403이 콘솔에 찍힌다 (거부 화면이 뜨는 것과 별개로 불필요한 요청).
  return { session, role, gate, allowed: gate === null };
}

// 역할 조회 중 표시할 자리
export function RoleLoading() {
  return (
    <main className="flex-1 grid place-items-center">
      <div className="skel w-12 h-12 !rounded-full" />
    </main>
  );
}

// 로그인은 했지만 역할이 안 맞을 때. API도 403이라 화면은 안내만 담당.
export function WrongRole({ need, role }: { need: "teacher" | "admin" | "student"; role: Role }) {
  return (
    <main className="flex-1 grid place-items-center px-5">
      <div className="card p-8 text-center max-w-sm">
        <p className="font-bold text-[16px] mb-1">{LABEL[need]} 계정만 쓸 수 있어요</p>
        <p className="text-sub text-[14px] mb-5">
          지금은 {role ? LABEL[role] : "역할이 정해지지 않은"} 계정으로 로그인돼 있어요.
        </p>
        <div className="flex flex-col gap-2">
          <Link href={homeFor(role)} className="btn btn-primary py-3">
            내 화면으로 가기
          </Link>
          <button className="btn btn-gray py-3" onClick={() => supabase.auth.signOut()}>
            로그아웃
          </button>
        </div>
      </div>
    </main>
  );
}

// 로그인이 필요할 때
export function NeedLogin({ as, message }: { as: "teacher" | "student"; message?: string }) {
  return (
    <main className="flex-1 grid place-items-center px-5">
      <div className="text-center">
        <p className="text-[16px] font-bold mb-1">로그인이 필요해요</p>
        <p className="text-sub text-[14px] mb-5">{message ?? "계정으로 로그인해 주세요."}</p>
        <Link href={`/login?role=${as}`} className="btn btn-primary py-3 px-6 inline-block">
          {LABEL[as]} 로그인
        </Link>
      </div>
    </main>
  );
}
