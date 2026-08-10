"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";
import { homeFor, roleFitsTab, type Role as RealRole } from "@/lib/role";

type Role = "teacher" | "student";

// 서버가 아는 실제 역할 조회 (가입 직후 프로필이 없으면 null)
async function fetchRole(token: string): Promise<RealRole> {
  const r = await fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } }).catch(
    () => null
  );
  const d = await r?.json().catch(() => null);
  return (d?.profile?.role as RealRole) ?? null;
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [role, setRole] = useState<Role>(params.get("role") === "teacher" ? "teacher" : "student");
  const [mode, setMode] = useState<"login" | "signup">("login");

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 이미 로그인돼 있으면 "실제" 역할에 맞는 화면으로 (탭 선택값이 아니라 서버 profiles 기준)
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      router.replace(homeFor(await fetchRole(data.session.access_token)));
    });
  }, [router]);

  async function submit() {
    setErr("");
    if (!id.trim() || !pw) return setErr("아이디와 비밀번호를 입력해 주세요.");
    setBusy(true);

    if (mode === "signup") {
      const academySlug = params.get("academy");
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          email: id.trim(),
          password: pw,
          name: name.trim() || id.trim(),
          // 같은 칸을 역할별로 다르게 쓴다 — 강사는 전역/원장 초대코드, 학생은 강사 초대코드
          ...(role === "student"
            ? { studentInviteCode: invite.trim() }
            : { inviteCode: invite.trim() }),
          academySlug,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setBusy(false);
        return setErr(d?.error ?? "가입하지 못했어요.");
      }
    }

    const { data: signed, error } = await supabase.auth.signInWithPassword({
      email: toEmail(id),
      password: pw,
    });
    if (error) {
      setBusy(false);
      setErr(mode === "login" ? "아이디나 비밀번호가 맞지 않아요." : error.message);
      return;
    }

    // 역할은 항상 서버 profiles 기준. 탭 선택값은 "이 탭으로는 이 역할만"이라는 필터일 뿐,
    // 역할을 정하는 근거로는 절대 쓰지 않는다 (탭을 신뢰하면 권한 상승이 된다).
    const realRole = await fetchRole(signed.session!.access_token);
    if (!roleFitsTab(role, realRole)) {
      await supabase.auth.signOut();
      setBusy(false);
      setErr(
        realRole === "admin"
          ? "학원장 계정이에요. 학원장 화면에서 로그인해 주세요."
          : realRole === "student"
            ? "학생 계정이에요. 학생 탭에서 로그인해 주세요."
            : realRole === "teacher"
              ? "강사 계정이에요. 강사 탭에서 로그인해 주세요."
              : "이 탭으로는 로그인할 수 없는 계정이에요."
      );
      return;
    }

    setBusy(false);
    router.replace(homeFor(realRole));
  }

  return (
    <main className="flex-1 w-full max-w-sm mx-auto px-5 py-14">
      {/* 역할 탭 */}
      <div className="rise flex gap-1.5 mb-7">
        {(
          [
            ["student", "학생"],
            ["teacher", "강사"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            onClick={() => {
              setRole(r);
              setErr("");
            }}
            className={`chip flex-1 !py-2.5 ${role === r ? "chip-on" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <h1 className="rise d1 text-[24px] font-extrabold">
        {role === "teacher" ? "강사" : "학생"} {mode === "login" ? "로그인" : "회원가입"}
      </h1>
      <div className="rise d2 mt-6 flex flex-col gap-3">
        <input
          className="field"
          placeholder="아이디 (이메일도 가능)"
          autoCapitalize="none"
          autoCorrect="off"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {mode === "signup" && (
          <>
            <input
              className="field"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="field"
              placeholder={role === "teacher" ? "초대코드" : "선생님 초대코드 (선택)"}
              autoCapitalize="none"
              autoCorrect="off"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
            {role === "student" && (
              <p className="text-sub text-[12px] -mt-1.5 leading-relaxed">
                선생님께 받은 코드를 넣으면 그 선생님 반에 바로 등록돼요. 없으면 비워두세요.
              </p>
            )}
          </>
        )}

        <button onClick={submit} disabled={busy} className="btn btn-primary py-4 mt-1">
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "가입하고 시작하기"}
        </button>

        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}

        <button
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setErr("");
          }}
          className="text-sub text-[14px] mt-1"
        >
          {mode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
        </button>

        {mode === "login" && (
          <Link href="/reset" className="text-sub text-[13px] text-center">
            비밀번호를 잊으셨나요?
          </Link>
        )}

      </div>
    </main>
  );
}
