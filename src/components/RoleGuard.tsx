"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { homeFor, type Role } from "@/lib/role";
import { useAuth, clearMustChangePassword } from "@/lib/auth-store";
import { useStudentTabs } from "@/components/StudentTabBar";

const LABEL: Record<"teacher" | "admin" | "student" | "dev", string> = {
  teacher: "강사",
  admin: "학원장",
  student: "학생",
  dev: "개발자",
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
  const { status, session, role, mustChangePassword } = useAuth();

  // any 페이지(기출·문제풀이 등)는 역할을 단정하지 않는다 — 강사가 세션 만료 후 와도 "학생 로그인"으로 오인 안 하게
  const loginAs = opts.loginAs ?? (need === "teacher" || need === "admin" ? "teacher" : need === "student" ? "student" : "any");

  // 상태를 3종으로 명시해 "조회 중"과 "비로그인"을 절대 섞지 않는다.
  // 섞으면 로그인한 사용자에게 비로그인 화면이 한 프레임 보인다.
  let gate: ReactNode | null = null;
  if (status === "loading" || role === undefined) gate = <RoleLoading />;
  else if (status === "signed-out" || !session)
    gate = opts.loginRender ?? <NeedLogin as={loginAs} message={opts.loginMessage} />;
  else if (need !== "any" && role !== need && !(role === null && opts.allowNoProfile))
    gate = <WrongRole need={need} role={role} />;
  // 초기 비밀번호(휴대폰 뒷자리)를 쓰는 계정은 바꾸기 전까지 어떤 화면도 못 쓴다.
  // 여기(공통 게이트)에 두면 모든 보호 페이지가 한 번에 막힌다.
  else if (mustChangePassword && session) gate = <ChangePassword session={session} />;

  // 데이터 페치 이펙트는 이걸 보고 돌아야 한다. session만 보면 권한 없는 사용자도 요청을 쏴서
  // 403이 콘솔에 찍힌다 (거부 화면이 뜨는 것과 별개로 불필요한 요청).
  return { session, role, gate, allowed: gate === null };
}

// 폰에선 화면 높이를 채워 주 버튼이 엄지 닿는 아래쪽에 오게 한다 (헤더 60px, 학생은 탭바 68px도 뺀다).
function useFillScreen() {
  return useStudentTabs()
    ? "max-lg:min-h-[calc(100dvh-128px-env(safe-area-inset-bottom))]"
    : "max-lg:min-h-[calc(100dvh-60px)]";
}

const TONE = {
  blue: { background: "var(--blue-weak)", color: "var(--blue)" },
  gray: { background: "var(--fill)", color: "var(--sub-2)" },
  red: { background: "var(--red-weak)", color: "var(--red)" },
} as const;

// 폰 하단 꽉 찬 버튼 (주/보조)
export const BIG_BTN = "btn btn-primary w-full h-[50px] text-[17px] grid place-items-center";
export const BIG_BTN_GRAY = "btn btn-gray w-full h-[50px] text-[16px] grid place-items-center";

// 상태 화면 공통 틀 (로그인 필요·역할 불일치·초대 링크 오류·404):
// 가운데 아이콘·제목·설명 + 하단 버튼.
export function StateScreen({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const fill = useFillScreen();
  return (
    <main className={`flex-1 w-full max-w-sm mx-auto px-6 pt-6 pb-8 lg:py-16 flex flex-col ${fill}`}>
      <div className="animate-pop flex-1 flex flex-col items-center justify-center text-center gap-3.5 py-10">
        {icon}
        <h1 className="mt-1.5 text-[22px] font-bold">{title}</h1>
        {children && <div className="text-[15px] leading-relaxed text-sub">{children}</div>}
      </div>
      {actions && <div className="flex flex-col gap-2">{actions}</div>}
    </main>
  );
}

// 상태 화면 가운데 아이콘 — 72px 둥근 칸 + 선 아이콘(path 목록)
export function StateIcon({ tone = "blue", paths }: { tone?: keyof typeof TONE; paths: string[] }) {
  return (
    <span className="grid place-items-center w-[72px] h-[72px] rounded-[16px]" style={TONE[tone]}>
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

// 첫 로그인 비밀번호 변경. 학생 가입이 휴대폰 뒷자리로 시작하므로 반드시 거쳐야 한다.
export function ChangePassword({ session }: { session: Session }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fill = useFillScreen();

  async function save() {
    if (busy) return;
    if (pw.length < 8) return setErr("비밀번호는 8자 이상으로 정해 주세요.");
    if (/^\d+$/.test(pw)) return setErr("숫자만으로는 안 돼요. 영문을 섞어 주세요.");
    if (pw !== pw2) return setErr("두 비밀번호가 서로 달라요.");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "비밀번호를 바꾸지 못했어요.");
      clearMustChangePassword(); // 재로그인 없이 바로 앱으로
    } catch {
      setErr("네트워크 오류로 바꾸지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  // 입력하는 동안 보여주는 조건 표시일 뿐 — 검증은 save가 한다
  const hints: [string, boolean][] = [
    ["8자 이상", pw.length >= 8],
    ["숫자만은 안 돼요", pw !== "" && !/^\d+$/.test(pw)],
  ];
  const mismatch = pw2 !== "" && pw !== pw2;

  return (
    <main className={`flex-1 w-full max-w-sm mx-auto px-6 pt-8 pb-8 lg:py-14 flex flex-col ${fill}`}>
      <span className="animate-pop self-start h-7 px-2.5 rounded-[8px] grid place-items-center text-[13px] font-bold" style={TONE.blue}>
        첫 로그인
      </span>
      <h1 className="animate-pop mt-3 text-[26px] leading-[1.35] font-bold tracking-[-0.5px]">
        비밀번호를
        <br />
        바꿔 주세요
      </h1>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-sub">
        지금은 휴대폰 뒷자리를 쓰고 있어요. 다른 사람이 알 수 있으니 나만 아는 비밀번호로 바꿔야
        시작할 수 있어요.
      </p>
      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-2 text-[13px] font-semibold" style={{ color: "var(--sub-2)" }}>
          새 비밀번호
          <input
            className="field text-[16px] font-normal text-text"
            type="password"
            placeholder="8자 이상, 영문 포함"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <span className="flex gap-3">
            {hints.map(([t, ok]) => (
              <span key={t} style={{ color: ok ? "var(--blue)" : "var(--sub)" }}>
                {ok ? "✓ " : ""}
                {t}
              </span>
            ))}
          </span>
        </label>
        <label className="flex flex-col gap-2 text-[13px] font-semibold" style={{ color: "var(--sub-2)" }}>
          새 비밀번호 확인
          <input
            className="field text-[16px] font-normal text-text"
            type="password"
            placeholder="한 번 더 입력"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            style={mismatch ? { borderColor: "var(--red)", background: "var(--red-weak)" } : undefined}
          />
          {mismatch && <span style={{ color: "var(--red)" }}>비밀번호가 서로 달라요</span>}
        </label>
      </div>
      <div className="flex-1 min-h-8" />
      {err && (
        <p role="alert" className="mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={TONE.red}>
          {err}
        </p>
      )}
      <button onClick={save} disabled={busy} className="btn btn-primary w-full h-[50px] text-[17px]">
        {busy ? "바꾸는 중…" : "바꾸고 시작하기"}
      </button>
      <button onClick={() => supabase.auth.signOut()} className="mt-4 text-[14px] text-sub">
        로그아웃
      </button>
    </main>
  );
}

// 역할 조회 중 자리. 화면 한가운데 스피너는 "빈 화면"처럼 보여서,
// 실제 콘텐츠와 비슷한 형태의 스켈레톤으로 자리를 잡아둔다.
function RoleLoading() {
  return (
    <main
      aria-busy="true"
      aria-label="불러오는 중"
      className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-4 lg:px-5 py-3 lg:py-8 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between h-12 px-1">
        <div className="skel h-[22px] w-[150px] !rounded-[8px]" />
        <div className="skel w-[34px] h-[34px] !rounded-full" />
      </div>
      <div className="card px-5 py-6 flex flex-col gap-3">
        <div className="skel h-3.5 w-2/5 !rounded-[8px]" />
        <div className="skel h-6 w-[70%] !rounded-[8px]" />
        <div className="skel h-[50px]" />
      </div>
      <div className="card p-5 flex gap-2.5">
        <div className="skel flex-1 h-[120px]" />
        <div className="skel flex-1 h-[120px]" />
      </div>
      <div className="card p-5 flex flex-col gap-3.5">
        <div className="skel h-[18px] w-[45%] !rounded-[8px]" />
        <div className="skel h-3.5 w-full !rounded-[8px]" />
        <div className="skel h-3.5 w-[90%] !rounded-[8px]" />
        <div className="skel h-3.5 w-4/5 !rounded-[8px]" />
      </div>
    </main>
  );
}

// 로그인은 했지만 역할이 안 맞을 때. API도 403이라 화면은 안내만 담당.
export function WrongRole({ need, role }: { need: "teacher" | "admin" | "student"; role: Role }) {
  return (
    <StateScreen
      icon={<StateIcon tone="gray" paths={["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M5.6 5.6l12.8 12.8"]} />}
      title={`${LABEL[need]} 계정만 쓸 수 있어요`}
      actions={
        <>
          <Link href={homeFor(role)} className={BIG_BTN}>
            내 화면으로 가기
          </Link>
          <button className={BIG_BTN_GRAY} onClick={() => supabase.auth.signOut()}>
            로그아웃하고 다른 계정으로
          </button>
        </>
      }
    >
      지금은 <b className="text-text">{role ? LABEL[role] : "역할이 정해지지 않은"} 계정</b>으로 로그인돼 있어요.
    </StateScreen>
  );
}

// 로그인이 필요할 때. 로그인 후 원래 보려던 화면으로 돌아오게 현재 경로를 넘긴다.
export function NeedLogin({ as, message }: { as: "teacher" | "student" | "any"; message?: string }) {
  const next = usePathname();
  const nextQ = next && next !== "/" ? `next=${encodeURIComponent(next)}` : "";
  const href = as === "any" ? `/login${nextQ ? `?${nextQ}` : ""}` : `/login?role=${as}${nextQ ? `&${nextQ}` : ""}`;
  return (
    <StateScreen
      icon={<StateIcon paths={["M8 11h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3z", "M8 11V8a4 4 0 0 1 8 0v3"]} />}
      title="로그인이 필요해요"
      actions={
        <Link href={href} className={BIG_BTN}>
          {as === "any" ? "로그인" : `${LABEL[as]} 로그인`}
        </Link>
      }
    >
      {message ?? "계정으로 로그인해 주세요."}
    </StateScreen>
  );
}
