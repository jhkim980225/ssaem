"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";

// 원장의 강사 초대 링크: 코드 검증 → 강사 가입(이름·과목) → 프로필 생성 → 대시보드로.
export default function JoinTeacherPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [academy, setAcademy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/join-teacher?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => (d.academy !== undefined ? setAcademy(d.academy) : setErr(d.error ?? "확인 실패")))
      .catch(() => setErr("확인 실패"));
  }, [code]);

  async function submit() {
    if (busy) return;
    setMsg("");
    setBusy(true);
    try {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "teacher", teacherInviteCode: code, email, password: pw }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
      // 가입은 아이디를 내부 이메일로 매핑해 저장하므로 로그인도 같은 매핑을 거쳐야 한다
      const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(email), password: pw });
      if (error || !data.session) {
        setMsg(error?.message ?? "로그인 실패");
        return;
      }
      const pr = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ name, subject }),
      });
      if (!pr.ok) {
        setMsg((await pr.json()).error ?? "프로필 저장 실패");
        return;
      }
      router.replace("/teacher");
    } finally {
      setBusy(false);
    }
  }

  if (err)
    return (
      <main className="flex-1 grid place-items-center px-5">
        <div className="text-center">
          <p className="text-[34px] mb-3">🔗</p>
          <p className="font-bold mb-1">초대 링크를 확인할 수 없어요</p>
          <p className="text-sub text-[14px]">{err}</p>
        </div>
      </main>
    );

  return (
    <main className="flex-1 w-full max-w-md mx-auto px-5 py-12 flex flex-col gap-5">
      {academy === null ? (
        <div className="skel h-52 !rounded-[20px]" />
      ) : (
        <>
          <div className="animate-pop card p-6">
            <p className="text-[13px] text-sub">강사 초대</p>
            <p className="text-[19px] font-extrabold">{academy || "학원"}</p>
            <p className="text-[13px] text-sub mt-1">가입하면 이 학원 소속 강사가 돼요.</p>
          </div>
          <div className="rise card p-6 flex flex-col gap-3">
            <input className="field" placeholder="이름 (학생에게 표시)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="field" placeholder="과목 (예: 전산회계 2급)" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <input className="field" placeholder="아이디 (영문·숫자 2~30자)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input
              className="field"
              type="password"
              placeholder="비밀번호 (8자 이상)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
              }}
            />
            <button onClick={submit} disabled={busy || !name || !email || pw.length < 8} className="btn btn-primary py-3.5">
              {busy ? "가입 중…" : "강사로 합류하기"}
            </button>
            {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
            {msg && <p className="text-[13px]" style={{ color: "var(--red)" }}>{msg}</p>}
          </div>
        </>
      )}
    </main>
  );
}
