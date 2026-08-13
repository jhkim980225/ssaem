"use client";
import { type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { homeFor, type Role } from "@/lib/role";
import { useAuth } from "@/lib/auth-store";

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
  const { status, session, role } = useAuth();

  const loginAs = opts.loginAs ?? (need === "teacher" || need === "admin" ? "teacher" : "student");

  // 상태를 3종으로 명시해 "조회 중"과 "비로그인"을 절대 섞지 않는다.
  // 섞으면 로그인한 사용자에게 비로그인 화면이 한 프레임 보인다.
  let gate: ReactNode | null = null;
  if (status === "loading" || role === undefined) gate = <RoleLoading />;
  else if (status === "signed-out" || !session)
    gate = opts.loginRender ?? <NeedLogin as={loginAs} message={opts.loginMessage} />;
  else if (need !== "any" && role !== need && !(role === null && opts.allowNoProfile))
    gate = <WrongRole need={need} role={role} />;

  // 데이터 페치 이펙트는 이걸 보고 돌아야 한다. session만 보면 권한 없는 사용자도 요청을 쏴서
  // 403이 콘솔에 찍힌다 (거부 화면이 뜨는 것과 별개로 불필요한 요청).
  return { session, role, gate, allowed: gate === null };
}

// 역할 조회 중 자리. 화면 한가운데 스피너는 "빈 화면"처럼 보여서,
// 실제 콘텐츠와 비슷한 형태의 스켈레톤으로 자리를 잡아둔다.
export function RoleLoading() {
  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-5 py-8 flex flex-col gap-3">
      <div className="skel h-7 w-40" />
      <div className="skel h-24 !rounded-[20px]" />
      <div className="skel h-40 !rounded-[20px]" />
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

// 로그인이 필요할 때. 로그인 후 원래 보려던 화면으로 돌아오게 현재 경로를 넘긴다.
export function NeedLogin({ as, message }: { as: "teacher" | "student"; message?: string }) {
  const next = usePathname();
  return (
    <main className="flex-1 grid place-items-center px-5">
      <div className="text-center">
        <p className="text-[16px] font-bold mb-1">로그인이 필요해요</p>
        <p className="text-sub text-[14px] mb-5">{message ?? "계정으로 로그인해 주세요."}</p>
        <Link
          href={`/login?role=${as}${next && next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`}
          className="btn btn-primary py-3 px-6 inline-block"
        >
          {LABEL[as]} 로그인
        </Link>
      </div>
    </main>
  );
}
