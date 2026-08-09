"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = { id: string; name: string; subject: string | null };

// 강사 초대 링크(QR) 진입점: 코드 검증 → 학생 로그인/가입 → 수강 연결 → 질문 화면으로.
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [err, setErr] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [joining, setJoining] = useState(false);

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/join?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => (d.teacher ? setTeacher(d.teacher) : setErr(d.error ?? "확인 실패")))
      .catch(() => setErr("확인 실패"));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [code]);

  async function join(s: Session) {
    setJoining(true);
    const r = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
      body: JSON.stringify({ code }),
    });
    const d = await r.json();
    setJoining(false);
    if (!r.ok) {
      setMsg(d.error ?? "연결 실패");
      return;
    }
    router.replace(`/ask?teacher=${d.teacherId}`);
  }

  async function submit() {
    setMsg("");
    if (mode === "signup") {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "student", name, email, password: pw }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
    }
    // 가입은 아이디를 내부 이메일로 매핑해 저장하므로 로그인도 같은 매핑을 거쳐야 한다
    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(email), password: pw });
    if (error || !data.session) {
      setMsg(error?.message ?? "로그인 실패");
      return;
    }
    await join(data.session);
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
      {!teacher ? (
        <div className="flex flex-col gap-3">
          <div className="skel h-24 !rounded-[20px]" />
          <div className="skel h-40 !rounded-[20px]" />
        </div>
      ) : (
        <>
          <div className="animate-pop card p-6 flex items-center gap-4">
            <span className="avatar !w-14 !h-14 !text-[20px]">{avatarEmoji(teacher.name)}</span>
            <div>
              <p className="text-[13px] text-sub">선생님의 초대</p>
              <p className="text-[19px] font-extrabold">{teacher.name}</p>
              {teacher.subject && <p className="text-[13px] text-sub">{teacher.subject}</p>}
            </div>
          </div>

          {session ? (
            <div className="rise card p-6 flex flex-col gap-3">
              <p className="text-[14px]">
                <b>{session.user.email}</b> 계정으로 등록할까요?
              </p>
              <button
                onClick={() => join(session)}
                disabled={joining}
                className="btn btn-primary py-3.5"
              >
                {joining ? "등록 중…" : `${teacher.name} 선생님 등록하고 질문하기`}
              </button>
              <button className="text-sub text-[13px]" onClick={() => supabase.auth.signOut()}>
                다른 계정 사용
              </button>
              {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
              {msg && <p className="text-[13px]" style={{ color: "var(--red)" }}>{msg}</p>}
            </div>
          ) : (
            <div className="rise card p-6 flex flex-col gap-3">
              <p className="font-bold text-[15px]">
                학생 {mode === "signup" ? "가입" : "로그인"} 후 바로 등록돼요
              </p>
              {mode === "signup" && (
                <input className="field" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <input className="field" placeholder="아이디 (이메일도 가능)" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              <button onClick={submit} className="btn btn-primary py-3.5">
                {mode === "signup" ? "가입하고 등록하기" : "로그인하고 등록하기"}
              </button>
              <button
                className="text-sub text-[13px]"
                onClick={() => setMode(mode === "signup" ? "login" : "signup")}
              >
                {mode === "signup" ? "이미 계정이 있나요? 로그인" : "계정이 없나요? 가입"}
              </button>
              {msg && <p className="text-[13px]" style={{ color: "var(--red)" }}>{msg}</p>}
            </div>
          )}
        </>
      )}
    </main>
  );
}
