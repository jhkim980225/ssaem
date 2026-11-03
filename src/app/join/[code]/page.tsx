"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";
import { avatarEmoji } from "@/lib/avatar";
import { StateScreen, StateIcon, BIG_BTN, BIG_BTN_GRAY } from "@/components/RoleGuard";
import AgreeTerms from "@/components/AgreeTerms";

type Teacher = { id: string; name: string; subject: string | null };

// 끊어진 링크 아이콘 (초대 링크 오류)
const BROKEN_LINK = [
  "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
  "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  "M4 4l16 16",
];

// 강사 초대 링크(QR) 진입점: 코드 검증 → 학생 로그인/가입 → 수강 연결 → 질문 화면으로.
export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  // 강좌 ROOM 초대 코드(c.…)면 어느 반으로 들어가는지 보여준다
  const [course, setCourse] = useState<{ id: string; title: string | null } | null>(null);
  const [err, setErr] = useState("");
  // 만료된 코드(410)는 "잘못된 링크"와 문구를 달리한다
  const [expired, setExpired] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [joining, setJoining] = useState(false);
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  // 학생 가입은 일반 회원가입과 동일하게 휴대폰을 받는다 (뒷 4자리가 첫 비밀번호)
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/join?code=${encodeURIComponent(code)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.teacher) {
          setTeacher(d.teacher);
          setCourse(d.course ?? null);
        } else {
          setExpired(!!d.expired);
          setErr(d.error ?? "확인 실패");
        }
      })
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
    // 버튼 disabled만으론 Enter 연타를 못 막는다
    if (busy) return;
    if (mode === "signup" && !agree) return setMsg("이용약관·개인정보처리방침에 동의해 주세요");
    setBusy(true);
    setMsg("");
    try {
    if (mode === "signup") {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 초대코드를 안 넘기면 서버가 학원을 못 찾아 "기본 학원"으로 프로필을 만든다.
        // 그러면 학생의 academy_id와 실제 수강 강사의 학원이 어긋난다 (테넌트 경계 깨짐).
        body: JSON.stringify({ role: "student", name, email, phone, studentInviteCode: code, agree }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
    }
    // 가입은 아이디를 내부 이메일로 매핑해 저장하므로 로그인도 같은 매핑을 거쳐야 한다.
    // 가입 직후엔 서버가 만든 초기 비밀번호(휴대폰 뒷 4자리)로 들어간다.
    const loginPw = mode === "signup" ? phone.replace(/[^0-9]/g, "").slice(-4) : pw;
    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(email), password: loginPw });
    if (error || !data.session) {
      setMsg(error?.message ?? "로그인 실패");
      return;
    }
    await join(data.session);
    } finally {
      setBusy(false);
    }
  }

  if (err)
    return (
      <StateScreen
        icon={<StateIcon paths={BROKEN_LINK} />}
        title={expired ? "초대 링크가 만료됐어요" : "초대 링크를 확인할 수 없어요"}
        actions={
          <>
            <Link href="/login?role=student" className={BIG_BTN}>
              학생 로그인
            </Link>
            <Link href="/" className={BIG_BTN_GRAY}>
              홈으로
            </Link>
          </>
        }
      >
        {err}
        {!expired && (
          <>
            <br />
            선생님께 새 QR이나 링크를 받아 주세요.
          </>
        )}
      </StateScreen>
    );

  const label = "flex flex-col gap-2 text-[13px] font-semibold";

  return (
    // 폰: 화면 높이를 채우고 주 버튼을 아래쪽에 둔다 (헤더 60px 제외)
    <main className="flex-1 w-full max-w-sm mx-auto px-6 pt-6 pb-8 lg:py-14 flex flex-col max-lg:min-h-[calc(100dvh-60px)]">
      {!teacher ? (
        <div className="flex flex-col gap-3">
          <div className="skel h-[92px] !rounded-[16px]" />
          <div className="skel h-7 w-3/5 mt-4 !rounded-[8px]" />
          <div className="skel h-[50px] !rounded-[10px]" />
          <div className="skel h-[50px] !rounded-[10px]" />
        </div>
      ) : (
        <>
          <section className="animate-pop rounded-[16px] p-5 flex items-center gap-3.5" style={{ background: "var(--blue-weak)" }}>
            <span className="avatar !w-[52px] !h-[52px] !text-[20px] !bg-blue !text-white">{avatarEmoji(teacher.name)}</span>
            <div className="min-w-0 flex flex-col gap-0.5">
              <span className="text-[13px] font-bold text-blue">선생님의 초대</span>
              <span className="text-[19px] font-bold break-keep">{teacher.name}</span>
              {(teacher.subject || course?.title) && (
                <span className="text-[14px] break-keep" style={{ color: "var(--sub-2)" }}>
                  {teacher.subject}
                  {teacher.subject && course?.title && " · "}
                  {course?.title && `「${course.title}」 반으로 등록돼요`}
                </span>
              )}
            </div>
          </section>

          {session ? (
            <>
              <h1 className="rise mt-7 text-[22px] leading-[1.4] font-bold tracking-[-0.4px]">이 계정으로 등록할까요?</h1>
              <p className="rise d1 mt-1.5 text-[15px] text-sub break-all">
                <b className="text-text">{session.user.email}</b> 계정으로 로그인돼 있어요.
              </p>

              <div className="flex-1 min-h-8" />

              {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
              {msg && (
                <p role="alert" className="mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={{ background: "var(--red-weak)", color: "var(--red)" }}>
                  {msg}
                </p>
              )}
              <button
                onClick={() => join(session)}
                disabled={joining}
                className="btn btn-primary w-full h-[50px] text-[17px]"
              >
                {joining ? "등록 중…" : `${teacher.name} 선생님 등록하고 질문하기`}
              </button>
              <button className="mt-4 text-[14px] text-sub" onClick={() => supabase.auth.signOut()}>
                다른 계정 사용
              </button>
            </>
          ) : (
            <>
              <h1 className="rise mt-7 text-[22px] leading-[1.4] font-bold tracking-[-0.4px]">
                {mode === "signup" ? "가입하면 바로 등록돼요" : "로그인하면 바로 등록돼요"}
              </h1>
              <p className="rise d1 mt-1.5 mb-5 text-[15px] text-sub">
                학생 {mode === "signup" ? "가입" : "로그인"} 후 선생님 반으로 자동 등록돼요.
              </p>

              <div className="rise d2 flex flex-col gap-3.5">
                {mode === "signup" && (
                  <label className={label} style={{ color: "var(--sub-2)" }}>
                    이름
                    <input className="field text-[16px] font-normal text-text" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                )}
                <label className={label} style={{ color: "var(--sub-2)" }}>
                  아이디
                  <input className="field text-[16px] font-normal text-text" placeholder="영문·숫자 2~30자" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                {mode === "signup" ? (
                  <label className={label} style={{ color: "var(--sub-2)" }}>
                    휴대폰 번호
                    <input
                      className="field text-[16px] font-normal text-text"
                      type="tel"
                      inputMode="numeric"
                      placeholder="숫자만, 예: 01012345678"
                      maxLength={11}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                      }}
                    />
                    <span className="font-medium text-sub leading-relaxed">
                      비밀번호는 <b>휴대폰 뒷 4자리</b>예요. 이대로 계속 쓰면 돼요.
                    </span>
                  </label>
                ) : (
                  <label className={label} style={{ color: "var(--sub-2)" }}>
                    비밀번호
                    <input
                      className="field text-[16px] font-normal text-text"
                      type="password"
                      placeholder="비밀번호"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                      }}
                    />
                  </label>
                )}
              </div>

              <div className="flex-1 min-h-8" />

              {mode === "signup" && (
                <div className="mb-4">
                  <AgreeTerms checked={agree} onChange={setAgree} />
                </div>
              )}
              {msg && (
                <p role="alert" className="mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={{ background: "var(--red-weak)", color: "var(--red)" }}>
                  {msg}
                </p>
              )}
              <button onClick={submit} disabled={busy || (mode === "signup" && !agree)} className="btn btn-primary w-full h-[50px] text-[17px]">
                {busy ? "처리 중…" : mode === "signup" ? "가입하고 등록하기" : "로그인하고 등록하기"}
              </button>
              <p className="mt-4 text-center text-[14px] text-sub">
                {mode === "signup" ? "이미 계정이 있나요? " : "계정이 없나요? "}
                <button
                  type="button"
                  className="font-bold text-blue"
                  onClick={() => setMode(mode === "signup" ? "login" : "signup")}
                >
                  {mode === "signup" ? "로그인" : "가입"}
                </button>
              </p>
            </>
          )}
        </>
      )}
    </main>
  );
}
