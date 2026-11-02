"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";
import { StateScreen, StateIcon, BIG_BTN, BIG_BTN_GRAY } from "@/components/RoleGuard";

// 끊어진 링크 아이콘 (초대 링크 오류)
const BROKEN_LINK = [
  "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1",
  "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  "M4 4l16 16",
];

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
      <StateScreen
        icon={<StateIcon paths={BROKEN_LINK} />}
        title="초대 링크를 확인할 수 없어요"
        actions={
          <>
            <Link href="/login?role=teacher" className={BIG_BTN}>
              강사 로그인
            </Link>
            <Link href="/" className={BIG_BTN_GRAY}>
              홈으로
            </Link>
          </>
        }
      >
        {err}
        <br />
        원장님께 새 초대 링크를 받아 주세요.
      </StateScreen>
    );

  const label = "flex flex-col gap-2 text-[13px] font-semibold";

  return (
    // 폰: 화면 높이를 채우고 주 버튼을 아래쪽에 둔다 (헤더 60px 제외)
    <main className="flex-1 w-full max-w-sm mx-auto px-6 pt-6 pb-8 lg:py-14 flex flex-col max-lg:min-h-[calc(100dvh-60px)]">
      {academy === null ? (
        <div className="flex flex-col gap-3">
          <div className="skel h-[120px] !rounded-[16px]" />
          <div className="skel h-[50px] mt-4 !rounded-[10px]" />
          <div className="skel h-[50px] !rounded-[10px]" />
        </div>
      ) : (
        <>
          <section className="animate-pop rounded-[16px] p-5 flex flex-col gap-1 bg-blue text-white">
            <span className="self-start h-[26px] px-2.5 rounded-[8px] grid place-items-center bg-white/15 text-[13px] font-bold">
              강사 초대
            </span>
            <span className="mt-2 text-[21px] font-bold break-keep">{academy || "학원"}</span>
            <span className="text-[14px] text-white/80">가입하면 이 학원 소속 강사가 돼요.</span>
          </section>

          <div className="rise mt-7 flex flex-col gap-3.5">
            <label className={label} style={{ color: "var(--sub-2)" }}>
              이름 · 학생에게 표시돼요
              <input className="field text-[16px] font-normal text-text" placeholder="김선생" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              과목
              <input className="field text-[16px] font-normal text-text" placeholder="예: 전산회계 2급" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              아이디
              <input className="field text-[16px] font-normal text-text" placeholder="영문·숫자 2~30자" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className={label} style={{ color: "var(--sub-2)" }}>
              비밀번호
              <input
                className="field text-[16px] font-normal text-text"
                type="password"
                placeholder="8자 이상"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
                }}
              />
            </label>
          </div>

          <div className="flex-1 min-h-8" />

          {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
          {msg && (
            <p role="alert" className="mb-3 rounded-[12px] px-4 py-3 text-[14px] font-bold" style={{ background: "var(--red-weak)", color: "var(--red)" }}>
              {msg}
            </p>
          )}
          <button
            onClick={submit}
            disabled={busy || !name || !email || pw.length < 8}
            className="btn btn-primary w-full h-[50px] text-[17px]"
          >
            {busy ? "가입 중…" : "강사로 합류하기"}
          </button>
        </>
      )}
    </main>
  );
}
