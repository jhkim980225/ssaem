"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";
import { avatarEmoji } from "@/lib/avatar";
import { SHOW_PRICING } from "@/lib/flags";
import { useGate } from "@/components/RoleGuard";

type AdminData = {
  admin: { name: string };
  academy: { name: string; slug: string; plan?: string };
  period: { days: number; options: number[] };
  stats: {
    teachers: number;
    students: number;
    activeStudents: number;
    questions: number;
    up: number;
    down: number;
  };
  work: { newDocuments: number; newQuestions: number };
  cumulative: { answers: number; minutesPerAnswer: number; hoursSaved: number };
  daily: { date: string; count: number }[];
  teachers: {
    id: string;
    name: string;
    subject: string | null;
    is_public: boolean;
    documents: number;
    questions: number;
    up: number;
    down: number;
  }[];
  students: { id: string; name: string; questions: number; lastAt: string | null }[];
  lowRated: { question: string; answer: string; teacher: string; created_at: string }[];
  usage: {
    plan: "free" | "pro";
    documents: { used: number; limit: number | null };
    questionsToday: { used: number; limit: number | null };
  };
  invite: { url: string; qrSvg: string };
};

const PERIOD_LABEL: Record<number, string> = { 7: "7일", 30: "30일", 90: "90일" };
const ago = (iso: string | null) => {
  if (!iso) return "기록 없음";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "오늘" : `${d}일 전`;
};

export default function AdminPage() {
  // 원장 가입(=학원 개설) 폼이 이 페이지에만 있어서 비로그인 화면을 직접 넘긴다
  const { session, gate } = useGate("admin", {
    loginRender: (
      <main className="flex-1 w-full mx-auto px-5 py-8 max-w-lg">
        <AuthForm />
      </main>
    ),
  });
  if (gate) return gate;

  return (
    <main className="flex-1 w-full mx-auto px-5 lg:px-8 py-8 max-w-lg lg:max-w-[1280px]">
      <Dashboard session={session!} />
    </main>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<"signup" | "login">("login"); // 기본 로그인, 가입은 하단 링크
  const [academyName, setAcademyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
    if (mode === "signup") {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin", academyName, name, email, password: pw, inviteCode }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
    }
    // 가입은 아이디를 내부 이메일로 매핑해 저장하므로 로그인도 같은 매핑을 거쳐야 한다
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(email), password: pw });
    if (error) setMsg("아이디나 비밀번호가 맞지 않아요.");
    } finally {
      setBusy(false);
    }
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
      <input className="field" placeholder="아이디 (이메일도 가능)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" placeholder="비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
      {mode === "signup" && (
        // 서버가 role=admin 가입에 INVITE_CODE를 요구한다 — 없으면 403
        <input className="field" placeholder="학원 개설 코드" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
      )}
      <button onClick={submit} disabled={busy} className="btn btn-primary py-4 mt-1 disabled:opacity-60">
        {busy ? "처리 중…" : mode === "signup" ? "학원 개설하기" : "로그인"}
      </button>
      <button onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="text-sub text-[14px] mt-1">
        {mode === "signup" ? "이미 계정이 있나요? 로그인" : "학원이 없나요? 개설하기"}
      </button>
      {mode !== "signup" && (
        <Link href="/reset" className="text-sub text-[13px] text-center">
          비밀번호를 잊으셨나요?
        </Link>
      )}
      {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
      {msg && <p className="text-[13px] mt-1" style={{ color: "var(--red)" }}>{msg}</p>}
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const [data, setData] = useState<AdminData | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/admin?days=${days}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => (d.academy ? setData(d) : setErr(d.error ?? "불러오기 실패")))
      .catch(() => setErr("불러오기 실패"));
  }, [session, days]);

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

  const label = PERIOD_LABEL[data.period.days] ?? `${data.period.days}일`;
  const maxDaily = Math.max(...data.daily.map((d) => d.count), 1);
  const idle = data.students.filter((s) => s.questions === 0);

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

      {/* 기간 선택 — 아래 숫자는 전부 이 기간 기준 (누적 답변만 예외) */}
      <div className="rise d1 flex items-center gap-1.5">
        {data.period.options.map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`chip !py-1.5 !px-3.5 !text-[13px] ${d === data.period.days ? "chip-on" : ""}`}
          >
            최근 {PERIOD_LABEL[d] ?? `${d}일`}
          </button>
        ))}
      </div>

      {/* 이번 기간 요약 — 재계약 대화의 근거가 되는 숫자들 */}
      <section className="rise d1 card p-5 lg:p-6">
        <h2 className="font-bold text-[17px]">최근 {label} 요약</h2>
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {(
            [
              ["등록된 자료", `${data.work.newDocuments}건`, "이 기간에 새로 들어간 자료"],
              ["학생 질문", `${data.stats.questions}건`, `강사 ${data.stats.teachers}명 · 학생 ${data.stats.students}명`],
              [
                "쓰고 있는 학생",
                `${data.stats.activeStudents}/${data.stats.students}명`,
                idle.length ? `${idle.length}명은 아직 안 써봤어요` : "전원 사용 중",
              ],
              ["답변 평가", `${data.stats.up} / ${data.stats.down}`, "도움됐어요 / 아쉬워요"],
            ] as const
          ).map(([k, v, sub]) => (
            <div key={k} className="rounded-[14px] border border-line p-4" style={{ background: "var(--fill-2)" }}>
              <p className="text-sub text-[12px]">{k}</p>
              <p className="text-[22px] font-extrabold tabular-nums mt-0.5">{v}</p>
              <p className="text-sub text-[11px] mt-1 leading-snug">{sub}</p>
            </div>
          ))}
        </div>

        {/* 누적 환산 — /pricing이 조교 인건비와 비교하는 논리를 화면에서 잇는다 */}
        <div className="mt-3 rounded-[14px] px-4 py-3.5" style={{ background: "var(--blue-weak)" }}>
          <p className="text-[14px] font-bold text-blue">
            지금까지 답변 {data.cumulative.answers.toLocaleString()}건 · 조교 약 {data.cumulative.hoursSaved}시간 분량
          </p>
          <p className="text-sub text-[11px] mt-1">
            답변 1건을 조교 응대 {data.cumulative.minutesPerAnswer}분으로 환산한 값이에요.
          </p>
        </div>

        {/* 오늘 사용량 — 무료 한도에 닿으면 학생 질문이 막히므로 미리 보여준다 */}
        {data.usage && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-[14px] border border-line px-4 py-3" style={{ background: "var(--fill-2)" }}>
            <div className="min-w-0">
              <p className="text-[13px] font-bold">
                오늘 질문 {data.usage.questionsToday.used}
                {data.usage.questionsToday.limit !== null && `/${data.usage.questionsToday.limit}`}건
              </p>
              <p className="text-sub text-[11px] mt-0.5">
                {data.usage.questionsToday.limit === null
                  ? "Pro · 질문 한도 없음"
                  : "무료 플랜 · 한도를 다 쓰면 다음 날까지 질문이 막혀요"}
              </p>
            </div>
            {data.usage.questionsToday.limit !== null && (
              <div className="w-28 h-2 rounded-full shrink-0" style={{ background: "var(--fill)" }}>
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: `${Math.min(100, (data.usage.questionsToday.used / data.usage.questionsToday.limit) * 100)}%`,
                    background:
                      data.usage.questionsToday.used >= data.usage.questionsToday.limit
                        ? "var(--red)"
                        : "var(--blue)",
                  }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      {/* 일별 질문 추이 */}
      {data.daily.some((d) => d.count > 0) && (
        <section className="rise d2 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-bold text-[15px]">일별 질문 수 (최근 {label})</h2>
            <span className="text-sub text-[12px]">최대 {maxDaily}건</span>
          </div>
          <div className="flex items-end gap-[2px] h-24" role="img" aria-label="일별 질문 수 막대 그래프">
            {data.daily.map((d) => (
              <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                  {d.date.slice(5).replace("-", "/")} · {d.count}건
                </span>
                <div
                  className="w-full max-w-[22px] rounded-t-[4px]"
                  style={{
                    background: "var(--blue)",
                    height: `${(d.count / maxDaily) * 100}%`,
                    minHeight: d.count > 0 ? 3 : 0,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-sub text-[11px]">
            <span>{data.daily[0]?.date.slice(5).replace("-", "/")}</span>
            <span>{data.daily.at(-1)?.date.slice(5).replace("-", "/")}</span>
          </div>
        </section>
      )}

      {/* 학생 참여 — "학생 N명"만으론 몇 명이 실제로 쓰는지 알 수 없다. 안 쓰는 학생이 해지 신호다. */}
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-2">
        <h2 className="font-bold text-[17px]">
          학생 {data.students.length}명 중 {data.stats.activeStudents}명 사용
        </h2>
        {data.students.length === 0 ? (
          <p className="text-sub text-[14px] py-4 text-center">아직 학생이 없어요.</p>
        ) : (
          <div className="flex flex-col gap-1.5 mt-1">
            {data.students.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2.5"
                style={{ background: "var(--fill-2)" }}
              >
                <span className="avatar !w-8 !h-8 !text-[14px]">{avatarEmoji(s.name)}</span>
                <p className="text-[14px] font-medium min-w-0 flex-1 truncate">{s.name}</p>
                {s.questions === 0 ? (
                  <span
                    className="chip !py-1 !px-2.5 !text-[12px] !cursor-default shrink-0"
                    style={{ color: "var(--red)" }}
                  >
                    미사용
                  </span>
                ) : (
                  <span className="text-[12px] text-sub shrink-0 text-right">
                    질문 {s.questions}건
                    <br />
                    <span className="text-[11px]">최근 {ago(s.lastAt)}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 아쉬움 받은 답변 — 지금까지 숫자만 보여서 원장이 품질을 확인할 수 없었다 */}
      {data.lowRated.length > 0 && (
        <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-2">
          <h2 className="font-bold text-[17px]">확인이 필요한 답변 {data.lowRated.length}건</h2>
          <p className="text-sub text-[13px] -mt-1">
            학생이 아쉬워요를 준 답변이에요. 관련 자료를 보강하면 좋아져요.
          </p>
          {data.lowRated.map((l, i) => (
            <details key={i} className="rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
              <summary className="text-[14px] font-medium cursor-pointer select-none">
                {l.question || "(제목 없음)"}
                <span className="text-sub text-[12px] ml-2">
                  {l.teacher} · {l.created_at.slice(5, 10).replace("-", "/")}
                </span>
              </summary>
              <p className="mt-2 text-[13px] text-sub leading-relaxed whitespace-pre-wrap">{l.answer}…</p>
            </details>
          ))}
        </section>
      )}

      {/* 강사 목록 */}
      <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-2">
        <h2 className="font-bold text-[17px]">소속 강사 {data.teachers.length}명</h2>
        {data.teachers.length === 0 ? (
          <p className="text-sub text-[14px] py-4 text-center">
            아직 강사가 없어요. 아래 초대 링크를 공유해 보세요.
          </p>
        ) : (
          data.teachers.map((t) => (
            <div key={t.id} className="rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
              {/* 통계+버튼은 좁은 화면(375px)에서 아래 줄로 내려야 이름이 안 잘린다 */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="avatar !w-10 !h-10 !text-[18px]">{avatarEmoji(t.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold truncate">
                    {t.name}
                    {!t.is_public && <span className="ml-1.5 text-[11px] text-sub">비공개</span>}
                  </p>
                  <p className="text-[12px] text-sub truncate">{t.subject ?? "과목 미설정"}</p>
                </div>
                <div className="flex items-center justify-between gap-3 w-full sm:w-auto">
                  <span className="text-[12px] text-sub sm:text-right">
                    자료 {t.documents} · 질문 {t.questions}
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
              </div>
            </div>
          ))
        )}
      </section>

      {/* 강사 초대 */}
      <section className="rise d4 card p-5 lg:p-6 flex flex-col gap-3">
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
            <p
              className="text-[13px] break-all rounded-[10px] border border-line px-3 py-2.5"
              style={{ background: "var(--fill-2)" }}
            >
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

      <Link href="/ask" className="rise d4 btn btn-ghost py-4 text-center">
        학생 화면으로 보기 →
      </Link>
    </div>
  );
}
