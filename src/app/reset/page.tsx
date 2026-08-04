"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// 비밀번호 재설정. 두 단계를 한 페이지에서 처리:
//  1) 메일 요청 — /reset 직접 진입
//  2) 새 비밀번호 설정 — 메일 링크로 진입(URL 해시의 recovery 토큰을 supabase-js가 세션으로 교환)
export default function ResetPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <ResetInner />
    </Suspense>
  );
}

function ResetInner() {
  const [mode, setMode] = useState<"request" | "update" | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    // 메일 링크 진입이면 recovery 세션이 잡힘 → 비밀번호 변경 단계
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("update");
    });
    supabase.auth.getSession().then(({ data }) => {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      setMode(data.session && /type=recovery/.test(hash) ? "update" : (m) => m ?? "request");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function sendMail() {
    setErr("");
    setMsg("");
    if (!email.trim()) return setErr("이메일을 입력해 주세요.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset`,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("메일을 보냈어요. 받은 편지함에서 링크를 눌러 주세요.");
  }

  async function updatePw() {
    setErr("");
    setMsg("");
    if (pw.length < 8) return setErr("비밀번호는 8자 이상이어야 해요.");
    if (pw !== pw2) return setErr("두 비밀번호가 서로 달라요.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("비밀번호를 바꿨어요. 이제 새 비밀번호로 로그인할 수 있어요.");
  }

  return (
    <main className="flex-1 w-full max-w-sm mx-auto px-5 py-16">
      <h1 className="rise text-[24px] font-extrabold">
        {mode === "update" ? "새 비밀번호 설정" : "비밀번호 재설정"}
      </h1>
      <p className="rise d1 text-sub text-[14px] mt-1.5 mb-6 leading-relaxed">
        {mode === "update"
          ? "쓸 비밀번호를 새로 입력해 주세요."
          : "가입한 이메일을 넣으면 재설정 링크를 보내드려요."}
      </p>

      <div className="rise d2 flex flex-col gap-3">
        {mode === "update" ? (
          <>
            <input
              className="field"
              type="password"
              placeholder="새 비밀번호 (8자 이상)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <input
              className="field"
              type="password"
              placeholder="새 비밀번호 확인"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && updatePw()}
            />
            <button onClick={updatePw} disabled={busy} className="btn btn-primary py-3.5">
              {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
            </button>
          </>
        ) : (
          <>
            <input
              className="field"
              type="email"
              placeholder="이메일"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMail()}
            />
            <button onClick={sendMail} disabled={busy} className="btn btn-primary py-3.5">
              {busy ? "보내는 중…" : "재설정 링크 받기"}
            </button>
          </>
        )}

        {msg && (
          <p className="animate-pop rounded-[12px] px-4 py-3 text-[13px] font-bold text-blue" style={{ background: "var(--blue-weak)" }}>
            {msg}
          </p>
        )}
        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}

        <div className="flex gap-3 justify-center pt-2 text-[13px] text-sub">
          <Link href="/teacher">강사 로그인</Link>
          <span>·</span>
          <Link href="/ask">학생 질문하기</Link>
        </div>
      </div>
    </main>
  );
}
