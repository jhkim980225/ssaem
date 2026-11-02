"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";

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
    if (busy) return;
    setErr("");
    setMsg("");
    if (!email.trim()) return setErr("이메일을 입력해 주세요.");
    setBusy(true);
    // 아이디로 가입한 계정은 <id>@ssaem.kr로 저장돼 있다. 같은 매핑을 거쳐야 요청이 성립한다.
    // (다만 그 주소는 수신함이 아니라 메일이 도달하지 않는다 — 아래 안내로 명시)
    const { error } = await supabase.auth.resetPasswordForEmail(toEmail(email.trim()), {
      redirectTo: `${window.location.origin}/reset`,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setMsg("메일을 보냈어요. 받은 편지함에서 링크를 눌러 주세요.");
  }

  async function updatePw() {
    if (busy) return;
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

  const label = "flex flex-col gap-2 text-[13px] font-semibold";

  return (
    // 폰: 화면 높이를 채우고 주 버튼을 아래쪽에 둔다 (헤더 60px 제외)
    <main className="flex-1 w-full max-w-sm mx-auto px-6 pt-6 pb-8 lg:py-14 flex flex-col max-lg:min-h-[calc(100dvh-60px)]">
      <Link href="/login" aria-label="로그인으로 돌아가기" className="-ml-3 w-11 h-11 grid place-items-center text-text">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </Link>

      <h1 className="rise mt-5 text-[26px] leading-[1.35] font-bold tracking-[-0.5px]">
        {mode === "update" ? "새 비밀번호를" : "비밀번호를"}
        <br />
        {mode === "update" ? "정해 주세요" : "다시 정할게요"}
      </h1>
      <p className="rise d1 mt-2 mb-7 text-[15px] text-sub leading-normal">
        {mode === "update"
          ? "쓸 비밀번호를 새로 입력해 주세요."
          : "가입한 이메일을 넣으면 재설정 링크를 보내드려요."}
      </p>

      <div className="rise d2 flex flex-col gap-4">
        {mode === "update" ? (
          <>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              새 비밀번호
              <input
                className="field text-[16px] font-normal text-text"
                type="password"
                placeholder="8자 이상"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
            </label>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              새 비밀번호 확인
              <input
                className="field text-[16px] font-normal text-text"
                type="password"
                placeholder="한 번 더 입력"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && updatePw()}
              />
            </label>
          </>
        ) : (
          <>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              이메일
              <input
                className="field text-[16px] font-normal text-text"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMail()}
              />
            </label>
            <div className="flex gap-3 rounded-[12px] p-4" style={{ background: "var(--fill)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 mt-px text-sub">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
              <p className="text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
                이메일 없이 아이디로 가입했다면 메일을 받을 수 없어요. 선생님께 비밀번호 초기화를 요청해 주세요.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-h-8" />

      {msg && (
        <p role="status" className="animate-pop mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold text-blue" style={{ background: "var(--blue-weak)" }}>
          {msg}
        </p>
      )}
      {err && (
        <p role="alert" className="mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={{ background: "var(--red-weak)", color: "var(--red)" }}>
          {err}
        </p>
      )}
      {mode === "update" ? (
        <button onClick={updatePw} disabled={busy} className="btn btn-primary w-full h-[50px] text-[17px]">
          {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
      ) : (
        <button onClick={sendMail} disabled={busy} className="btn btn-primary w-full h-[50px] text-[17px]">
          {busy ? "보내는 중…" : "재설정 링크 받기"}
        </button>
      )}

      <div className="mt-4 flex gap-3 justify-center text-[14px] text-sub">
        <Link href="/teacher">강사 로그인</Link>
        <span aria-hidden>·</span>
        <Link href="/ask">학생 질문하기</Link>
      </div>
    </main>
  );
}
