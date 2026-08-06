"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";

type Role = "teacher" | "student";

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

  // 이미 로그인돼 있으면 각자 화면으로
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(role === "teacher" ? "/teacher" : "/ask");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const home = role === "teacher" ? "/teacher" : "/ask";

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
          inviteCode: invite.trim(),
          academySlug,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setBusy(false);
        return setErr(d?.error ?? "가입하지 못했어요.");
      }
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: toEmail(id),
      password: pw,
    });
    setBusy(false);
    if (error) {
      setErr(mode === "login" ? "아이디나 비밀번호가 맞지 않아요." : error.message);
      return;
    }
    router.replace(home);
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
      <p className="rise d1 text-sub text-[14px] mt-1.5 mb-6 leading-relaxed">
        {role === "teacher"
          ? "내 자료로 답하는 AI 튜터를 만들고 관리해요."
          : "선생님 자료를 근거로 궁금한 걸 물어봐요."}
      </p>

      <div className="rise d2 flex flex-col gap-3">
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
            {role === "teacher" && (
              <input
                className="field"
                placeholder="초대코드"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
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

        {role === "student" && (
          <Link href="/ask" className="text-sub text-[13px] text-center pt-1">
            로그인 없이 먼저 둘러보기
          </Link>
        )}
      </div>
    </main>
  );
}
