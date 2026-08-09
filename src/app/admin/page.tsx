"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { avatarEmoji } from "@/lib/avatar";
import { SHOW_PRICING } from "@/lib/flags";
import { useRole } from "@/lib/role";
import { RoleLoading, WrongRole } from "@/components/RoleGuard";

type AdminData = {
  admin: { name: string };
  academy: { name: string; slug: string; plan?: string };
  teachers: {
    id: string;
    name: string;
    subject: string | null;
    is_public: boolean;
    documents: number;
    students: { id: string; name: string }[];
    up: number;
    down: number;
  }[];
  stats: { teachers: number; students: number; recentQuestions: number };
  insights?: { days: number; daily: { date: string; count: number }[] };
  invite: { url: string; qrSvg: string };
};

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const role = useRole(session);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <RoleLoading />;

  if (!session)
    return (
      <main className="flex-1 w-full mx-auto px-5 py-8 max-w-lg">
        <AuthForm />
      </main>
    );

  if (role === undefined) return <RoleLoading />;
  if (role !== "admin") return <WrongRole need="admin" role={role} />;

  return (
    <main className="flex-1 w-full mx-auto px-5 lg:px-8 py-8 max-w-lg lg:max-w-[1280px]">
      <Dashboard session={session} />
    </main>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<"signup" | "login">("login"); // 기본 로그인, 가입은 하단 링크
  const [academyName, setAcademyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    if (mode === "signup") {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", academyName, name, email, password: pw }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setMsg(error.message);
  }

  return (
    <div className="animate-pop flex flex-col gap-3 max-w-sm mx-auto mt-10">
      <h1 className="rise d1 text-[26px] font-extrabold">
        학원장 {mode === "signup" ? "가입" : "로그인"}
      </h1>
      <p className="rise d2 text-sub text-[14px] mb-3">
        학원을 개설하고 강사를 초대해 운영하세요.
      </p>
      {mode === "signup" && (
        <>
          <input className="field" placeholder="학원 이름" value={academyName} onChange={(e) => setAcademyName(e.target.value)} />
          <input className="field" placeholder="원장 이름" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      <input className="field" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" placeholder="비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button onClick={submit} className="btn btn-primary py-4 mt-1">
        {mode === "signup" ? "학원 개설하기" : "로그인"}
      </button>
      <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="text-sub text-[14px] mt-1">
        {mode === "signup" ? "이미 계정이 있나요? 로그인" : "학원이 없나요? 개설하기"}
      </button>
      {mode !== "signup" && (
        <Link href="/reset" className="text-sub text-[13px] text-center">
          비밀번호를 잊으셨나요?
        </Link>
      )}
      {msg && <p className="text-[13px] text-blue mt-1">{msg}</p>}
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => (d.academy ? setData(d) : setErr(d.error ?? "불러오기 실패")))
      .catch(() => setErr("불러오기 실패"));
  }, [session]);

  async function togglePublic(teacherId: string) {
    const r = await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ teacherId }),
    });
    const d = await r.json();
    if (r.ok)
      setData((prev) =>
        prev
          ? { ...prev, teachers: prev.teachers.map((t) => (t.id === teacherId ? { ...t, is_public: d.is_public } : t)) }
          : prev
      );
  }

  if (err)
    return (
      <div className="card p-8 text-center max-w-sm mx-auto mt-10">
        <p className="font-bold mb-1">{err}</p>
        <p className="text-sub text-[13px] mb-4">이 화면은 학원장 계정 전용이에요.</p>
        <button className="btn btn-gray py-2.5 px-5 text-[14px]" onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );

  if (!data)
    return (
      <div className="flex flex-col gap-3">
        <div className="skel h-20 !rounded-[20px]" />
        <div className="skel h-40 !rounded-[20px]" />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <p className="text-sub text-[13px]">학원장 대시보드</p>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold flex items-center gap-2">
            {data.academy.name}
            {data.academy.plan === "pro" ? (
              <span className="chip chip-on !cursor-default !px-2.5 !py-0.5 !text-[11px]">Pro</span>
            ) : SHOW_PRICING ? (
              <a href="/pricing" className="chip !px-2.5 !py-0.5 !text-[11px]">무료 · Pro 보기</a>
            ) : (
              <span className="chip !cursor-default !px-2.5 !py-0.5 !text-[11px]">무료</span>
            )}
          </h1>
          <p className="text-sub text-[13px]">
            학생 초대 URL: /a/{data.academy.slug} · {data.admin.name} 원장
          </p>
        </div>
        <button className="text-sub text-[13px] shrink-0" onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>

      {/* 스탯 */}
      <div className="rise d1 grid grid-cols-3 gap-2">
        {(
          [
            ["강사", data.stats.teachers],
            ["학생", data.stats.students],
            ["질문 (7일)", data.stats.recentQuestions],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="card p-4">
            <p className="text-sub text-[12px]">{label}</p>
            <p className="text-[24px] font-extrabold tabular-nums">{n}</p>
          </div>
        ))}
      </div>

      {/* 학원 인사이트 — 일별 질문 추이 (14일) */}
      {(data.insights?.daily.some((d) => d.count > 0) ?? false) && (
        <section className="rise d2 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-bold text-[15px]">일별 질문 수 (최근 {data.insights!.days}일)</h2>
            <span className="text-sub text-[12px]">
              최대 {Math.max(...data.insights!.daily.map((d) => d.count))}건
            </span>
          </div>
          <div className="flex items-end gap-[2px] h-24" role="img" aria-label="일별 질문 수 막대 그래프">
            {data.insights!.daily.map((d) => {
              const max = Math.max(...data.insights!.daily.map((x) => x.count), 1);
              return (
                <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                  <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                    {d.date.slice(5).replace("-", "/")} · {d.count}건
                  </span>
                  <div
                    className="w-full max-w-[22px] rounded-t-[4px]"
                    style={{ background: "var(--blue)", height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 3 : 0 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-sub text-[11px]">
            <span>{data.insights!.daily[0]?.date.slice(5).replace("-", "/")}</span>
            <span>{data.insights!.daily.at(-1)?.date.slice(5).replace("-", "/")}</span>
          </div>
        </section>
      )}

      {/* 강사 초대 */}
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">강사 초대</h2>
        <p className="text-sub text-[13px] -mt-1">
          QR이나 링크로 강사를 초대하세요. 가입하면 우리 학원 소속이 돼요.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div
            className="rounded-[14px] border border-line p-2 bg-white shrink-0 [&>svg]:block [&>svg]:w-[150px] [&>svg]:h-[150px]"
            dangerouslySetInnerHTML={{ __html: data.invite.qrSvg }}
          />
          <div className="flex flex-col gap-2 min-w-0 w-full">
            <p className="text-[13px] break-all rounded-[10px] border border-line px-3 py-2.5" style={{ background: "var(--fill-2)" }}>
              {data.invite.url}
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(data.invite.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
              className="btn btn-ghost py-2.5 px-5 self-start text-[14px]"
            >
              {copied ? "복사됨 ✓" : "링크 복사"}
            </button>
          </div>
        </div>
      </section>

      {/* 강사 목록 */}
      <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-2">
        <h2 className="font-bold text-[17px]">소속 강사 {data.teachers.length}명</h2>
        {data.teachers.length === 0 ? (
          <p className="text-sub text-[14px] py-4 text-center">
            아직 강사가 없어요. 위 초대 링크를 공유해 보세요.
          </p>
        ) : (
          data.teachers.map((t) => (
            <div
              key={t.id}
              className="rounded-[14px] border border-line p-3"
              style={{ background: "var(--fill-2)" }}
            >
              <div className="flex items-center gap-3">
                <span className="avatar !w-10 !h-10 !text-[18px]">{avatarEmoji(t.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold truncate">
                    {t.name}
                    {!t.is_public && <span className="ml-1.5 text-[11px] text-sub">비공개</span>}
                  </p>
                  <p className="text-[12px] text-sub truncate">{t.subject ?? "과목 미설정"}</p>
                </div>
                <span className="text-[12px] text-sub shrink-0 text-right">
                  자료 {t.documents} · 학생 {t.students.length}
                  {(t.up > 0 || t.down > 0) && (
                    <>
                      <br />
                      도움됨 {t.up} · 아쉬움{" "}
                      <span style={t.down > 0 ? { color: "var(--red)", fontWeight: 700 } : undefined}>{t.down}</span>
                    </>
                  )}
                </span>
                <button
                  onClick={() => togglePublic(t.id)}
                  className="chip !py-1 !px-2.5 !text-[12px] shrink-0"
                  title={t.is_public ? "학생 목록에서 숨기기" : "학생 목록에 공개하기"}
                >
                  {t.is_public ? "숨기기" : "공개하기"}
                </button>
              </div>
              {t.students.length > 0 && (
                <details className="mt-2 pl-[52px]">
                  <summary className="text-[12px] text-sub cursor-pointer select-none">
                    학생 목록 보기
                  </summary>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.students.map((s) => (
                      <span key={s.id} className="chip !py-1 !px-2.5 !text-[12px] !cursor-default">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))
        )}
      </section>

      <Link href="/ask" className="rise d4 btn btn-ghost py-4 text-center">
        학생 화면으로 보기 →
      </Link>
    </div>
  );
}
