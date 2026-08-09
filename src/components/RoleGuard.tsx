"use client";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { homeFor, type Role } from "@/lib/role";

const LABEL: Record<"teacher" | "admin" | "student", string> = {
  teacher: "강사",
  admin: "학원장",
  student: "학생",
};

// 역할 조회 중 표시할 자리
export function RoleLoading() {
  return (
    <main className="flex-1 grid place-items-center">
      <div className="skel w-12 h-12 !rounded-full" />
    </main>
  );
}

// 로그인은 했지만 역할이 안 맞을 때. API도 403이라 화면은 안내만 담당.
export function WrongRole({ need, role }: { need: "teacher" | "admin"; role: Role }) {
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
