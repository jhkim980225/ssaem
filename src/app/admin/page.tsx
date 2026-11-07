"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { toEmail, isValidId } from "@/lib/account";
import { avatarEmoji } from "@/lib/avatar";
import { useGate } from "@/components/RoleGuard";
import InviteBox from "@/components/InviteBox";
import AdminSidebar, { type AdminView, type AdminNavItem } from "@/components/AdminSidebar";

type AdminData = {
  admin: { name: string };
  academy: { name: string; slug: string };
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
  assessments: { id: string; title: string; teacher: string; created_at: string; attempts: number }[];
  invite: { url: string; qrSvg: string };
};

const PERIOD_LABEL: Record<number, string> = { 7: "7일", 30: "30일", 90: "90일" };
const ago = (iso: string | null) => {
  if (!iso) return "기록 없음";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "오늘" : `${d}일 전`;
};

export default function AdminPage() {
  // 원장 로그인 폼이 이 페이지에만 있어서 비로그인 화면을 직접 넘긴다
  const { session, gate } = useGate("admin", {
    loginRender: (
      <main className="flex-1 w-full mx-auto px-5 py-8 max-w-lg">
        <AuthForm />
      </main>
    ),
  });
  if (gate) return gate;

  // 메뉴(?v=)를 useSearchParams로 읽어서 Suspense 필수
  return (
    <Suspense fallback={null}>
      <Dashboard session={session!} />
    </Suspense>
  );
}

const VIEWS: AdminView[] = ["overview", "students", "teachers", "low-rated", "reviews", "assessments", "invite"];
const MAIN = "flex-1 min-w-0 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-3 lg:gap-4";

function AuthForm() {
  // 마스터회계 전용 배포라 학원 개설(원장 가입) 화면은 뺐다 — 원장 계정은 이미 있다.
  // 서버 /api/signup의 role=admin 경로(INVITE_CODE 필요)는 검사 스크립트가 쓰므로 그대로 둔다.
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    // 원장 계정은 아이디 형식만 — 이메일 입력 차단
    if (email.includes("@") || !isValidId(email)) {
      setMsg("이메일이 아니라 아이디 형식(영문·숫자·._- 2~30자)으로 입력해 주세요.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      // 가입은 아이디를 내부 이메일로 매핑해 저장하므로 로그인도 같은 매핑을 거쳐야 한다
      const { error } = await supabase.auth.signInWithPassword({ email: toEmail(email), password: pw });
      if (error) setMsg("아이디나 비밀번호가 맞지 않아요.");
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-2 text-[13px] font-semibold text-[color:var(--sub-2)]";
  return (
    <div className="animate-pop flex flex-col max-w-sm mx-auto mt-4">
      <div className="rise flex items-center gap-2">
        <span className="w-7 h-7 rounded-[9px] grid place-items-center text-[15px] font-bold text-white bg-blue">원</span>
        <span className="text-[15px] font-bold">학원장</span>
      </div>
      <h1 className="rise d1 mt-7 text-[26px] leading-[1.35] font-bold tracking-[-0.5px]">
        학원장 로그인
      </h1>
      <p className="rise d2 mt-1.5 mb-5 text-sub text-[15px]">학원장 계정으로 로그인해요.</p>

      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={label}>
          아이디
          <input className="field" placeholder="영문·숫자 2~30자" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={label}>
          비밀번호
          <input className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>

        {/* msg는 실패에만 세팅된다 — 성공 톤(파랑)으로 보이면 안 됨 */}
        {msg && (
          <p className="mt-0.5 rounded-[12px] px-4 py-3 text-[14px] font-semibold" style={{ background: "var(--red-weak)", color: "var(--red)" }}>
            {msg}
          </p>
        )}
        <button type="submit" disabled={busy} className="btn btn-primary h-[50px] mt-2.5 text-[17px] disabled:opacity-60">
          {busy ? "처리 중…" : "로그인"}
        </button>
      </form>
      <Link href="/reset" className="mt-4 text-sub text-[14px] text-center">
        비밀번호를 잊으셨나요?
      </Link>
    </div>
  );
}

type AdminReviews = {
  reviews: { id: string; teacher: string; student: string; rating: number; comment: string | null; updatedAt: string }[];
  byTeacher: { teacherId: string; teacher: string; count: number; avg: number }[];
};

function Dashboard({ session }: { session: Session }) {
  const params = useSearchParams();
  const v = params.get("v") as AdminView | null;
  const view: AdminView = v && VIEWS.includes(v) ? v : "overview";
  const [data, setData] = useState<AdminData | null>(null);
  // 수강평 — 원장에게만 작성자 실명이 함께 온다 (강사 화면은 익명)
  const [rev, setRev] = useState<AdminReviews | null>(null);
  const [days, setDays] = useState(30);
  const [err, setErr] = useState("");
  // 학생 연락처·메모 — 개인정보라 펼친 학생만 조회한다 (목록에 싣지 않는다)
  const [openStu, setOpenStu] = useState<string | null>(null);
  const [stuDetail, setStuDetail] = useState<Record<string, { phone: string; note: string }>>({});
  // 학원명 수정 (null = 보기 모드)
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameMsg, setNameMsg] = useState("");
  // 학생 제명 확인 모달 대상
  const [expel, setExpel] = useState<{ id: string; name: string } | null>(null);
  const [expelBusy, setExpelBusy] = useState(false);
  const [expelMsg, setExpelMsg] = useState("");
  const [csvMsg, setCsvMsg] = useState("");

  useEffect(() => {
    fetch(`/api/admin?days=${days}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => (d.academy ? setData(d) : setErr(d.error ?? "불러오기 실패")))
      .catch(() => setErr("불러오기 실패"));
  }, [session, days]);

  useEffect(() => {
    // 수강평은 기간과 무관 — 한 번만 불러온다. 실패해도 대시보드 나머지는 그대로.
    fetch("/api/reviews", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setRev(d))
      .catch(() => {});
  }, [session]);

  async function toggleStudent(studentId: string) {
    if (openStu === studentId) return setOpenStu(null);
    setOpenStu(studentId);
    if (stuDetail[studentId]) return;
    try {
      const r = await fetch(`/api/students/detail?student=${studentId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      setStuDetail((p) => ({
        ...p,
        [studentId]: { phone: d.detail?.phone ?? "", note: d.detail?.note ?? "" },
      }));
    } catch {
      /* 조회 실패는 조용히 — 목록은 그대로 */
    }
  }

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

  const auth = { Authorization: `Bearer ${session.access_token}` };

  async function saveName() {
    if (nameDraft === null) return;
    setNameMsg("");
    const r = await fetch("/api/admin/academy", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ name: nameDraft }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok) return setNameMsg(d?.error || "학원 이름을 바꾸지 못했어요.");
    setData((prev) => (prev ? { ...prev, academy: { ...prev.academy, name: d.name } } : prev));
    setNameDraft(null);
  }

  async function confirmExpel() {
    if (!expel || expelBusy) return;
    setExpelBusy(true);
    setExpelMsg("");
    try {
      const r = await fetch(`/api/admin/students?id=${expel.id}`, { method: "DELETE", headers: auth });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        return setExpelMsg(d?.error || "학생을 내보내지 못했어요.");
      }
      const id = expel.id;
      setData((prev) => {
        if (!prev) return prev;
        const gone = prev.students.find((s) => s.id === id);
        return {
          ...prev,
          students: prev.students.filter((s) => s.id !== id),
          stats: {
            ...prev.stats,
            students: prev.stats.students - 1,
            activeStudents: prev.stats.activeStudents - (gone && gone.questions > 0 ? 1 : 0),
          },
        };
      });
      setOpenStu(null);
      setExpel(null);
    } catch {
      setExpelMsg("학생을 내보내지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setExpelBusy(false);
    }
  }

  /** 평가 결과 CSV 내려받기 — 강사 화면과 같은 API (원장은 우리 학원 강사 평가 전부 허용) */
  async function downloadResults(id: string, title: string) {
    setCsvMsg("");
    try {
      const r = await fetch(`/api/assessments/${id}/results?csv=1`, { headers: auth });
      if (!r.ok) return setCsvMsg("결과를 내려받지 못했어요.");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}_결과.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setCsvMsg("결과를 내려받지 못했어요 — 네트워크를 확인해 주세요.");
    }
  }

  if (err)
    return (
      <main className={MAIN}>
        <div className="card p-8 text-center max-w-sm mx-auto mt-10">
          <p className="font-bold mb-1">{err}</p>
          <p className="text-sub text-[13px] mb-4">이 화면은 학원장 계정 전용이에요.</p>
          <button className="btn btn-gray py-2.5 px-5 text-[14px]" onClick={() => supabase.auth.signOut()}>
            로그아웃
          </button>
        </div>
      </main>
    );

  if (!data)
    return (
      <main className={MAIN}>
        <div className="skel h-20 !rounded-[16px]" />
        <div className="skel h-40 !rounded-[16px]" />
      </main>
    );

  const label = PERIOD_LABEL[data.period.days] ?? `${data.period.days}일`;
  const maxDaily = Math.max(...data.daily.map((d) => d.count), 1);
  const idle = data.students.filter((s) => s.questions === 0);
  // 7일은 막대마다 날짜를 단다. 30·90일은 양 끝 날짜만.
  const few = data.daily.length <= 7;
  const md = (iso: string) => iso.slice(5, 10).replace("-", "/");
  const hidden = data.teachers.filter((t) => !t.is_public).length;
  const revAvg = rev?.reviews.length ? rev.reviews.reduce((s, r) => s + r.rating, 0) / rev.reviews.length : 0;
  const h2 = "font-bold text-[17px] lg:text-[19px]";

  const statBox = "card p-4 lg:p-5";
  const statKey = "text-[13px] lg:text-[14px] text-sub";
  const statVal = "mt-1 lg:mt-1.5 text-[24px] lg:text-[28px] font-bold tabular-nums leading-tight";
  const statSub = "mt-1 text-[12px] lg:text-[13px] text-sub leading-snug";

  // 사이드바 메뉴 — 예전엔 한 화면에 카드를 전부 쌓고 폰에서만 목차를 달았다.
  // 강사 화면과 같은 좌측 메뉴로 나눠 한 번에 한 가지만 보여준다.
  const nav: AdminNavItem[] = [
    { view: "overview", label: "대시보드" },
    { view: "students", label: "학생 관리", count: `${data.stats.activeStudents}/${data.students.length}`, warn: idle.length > 0 },
    { view: "teachers", label: "소속 강사", count: data.teachers.length },
    { view: "low-rated", label: "확인이 필요한 답변", count: data.lowRated.length, warn: data.lowRated.length > 0 },
    { view: "reviews", label: "수강평", count: rev?.reviews.length ?? 0 },
    { view: "assessments", label: "평가 결과", count: data.assessments.length },
    { view: "invite", label: "강사 초대" },
  ];
  // 기간 선택이 숫자를 바꾸는 화면만 기간 탭을 단다 (수강평·평가·초대는 기간과 무관)
  const periodViews: AdminView[] = ["overview", "students", "teachers", "low-rated"];
  const shortcuts: { view: AdminView; title: string; sub: string; warn?: boolean }[] = [
    { view: "students", title: "학생 참여", sub: idle.length ? `${idle.length}명은 아직 안 써봤어요` : "전원 사용 중", warn: idle.length > 0 },
    { view: "low-rated", title: "확인이 필요한 답변", sub: data.lowRated.length ? `${data.lowRated.length}건` : "없어요", warn: data.lowRated.length > 0 },
    { view: "teachers", title: "소속 강사", sub: `${data.teachers.length}명${hidden ? ` · ${hidden}명 비공개` : ""}` },
    { view: "reviews", title: "수강평", sub: rev?.reviews.length ? `${rev.reviews.length}건 · 평균 ★ ${revAvg.toFixed(1)}` : "아직 없어요" },
    { view: "assessments", title: "평가 결과", sub: data.assessments.length ? `${data.assessments.length}건 · CSV 내려받기` : "아직 없어요" },
    { view: "invite", title: "강사 초대", sub: "QR·링크로 강사를 초대해요" },
  ];
  const empty = (msg: string) => <p className="text-sub text-[14px] py-6 text-center">{msg}</p>;

  return (
    <div className="flex-1 w-full max-w-[1700px] mx-auto lg:flex lg:items-start">
    <AdminSidebar academy={data.academy.name} admin={data.admin.name} items={nav} current={view} />
    <main className={MAIN}>
      {/* 제목 + 기간 선택 — 아래 숫자는 전부 이 기간 기준 (누적 답변만 예외) */}
      <div className="rise flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-[12px] lg:text-[14px] font-bold text-blue">학원장 대시보드</p>
            {nameDraft === null ? (
              <div className="mt-0.5 flex items-center gap-1 min-w-0">
                <h1 className="text-[20px] lg:text-[28px] font-bold tracking-[-0.5px] break-keep min-w-0">
                  {data.academy.name}
                </h1>
                <button
                  className="shrink-0 h-8 px-2 text-sub text-[13px] font-semibold"
                  onClick={() => {
                    setNameMsg("");
                    setNameDraft(data.academy.name);
                  }}
                >
                  이름 수정
                </button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    className="field !py-2 min-w-0 flex-1"
                    aria-label="학원 이름"
                    maxLength={40}
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveName();
                      if (e.key === "Escape") setNameDraft(null);
                    }}
                    autoFocus
                  />
                  <button className="btn btn-primary shrink-0 h-10 px-4 text-[14px]" onClick={saveName}>
                    저장
                  </button>
                  <button className="btn btn-gray shrink-0 h-10 px-3 text-[14px]" onClick={() => setNameDraft(null)}>
                    취소
                  </button>
                </div>
                {nameMsg && (
                  <p className="text-[13px] font-semibold" style={{ color: "var(--red)" }}>
                    {nameMsg}
                  </p>
                )}
              </div>
            )}
            <p className="mt-1 text-sub text-[13px] lg:text-[14px] break-all">
              학생 초대 URL: /a/{data.academy.slug} · {data.admin.name} 원장
            </p>
          </div>
        </div>
        {periodViews.includes(view) && (
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="기간"
            className="flex-1 lg:flex-none grid grid-cols-3 gap-1 p-1 rounded-[10px]"
            style={{ background: "var(--fill)" }}
          >
            {data.period.options.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={d === data.period.days}
                onClick={() => setDays(d)}
                className={`h-9 lg:px-4 rounded-[7px] text-[14px] whitespace-nowrap ${
                  d === data.period.days ? "bg-surface font-bold" : "font-semibold text-[color:var(--sub-2)]"
                }`}
              >
                최근 {PERIOD_LABEL[d] ?? `${d}일`}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>

      {view === "overview" && (
        <>
      {/* 이번 기간 요약 — 재계약 대화의 근거가 되는 숫자들 */}
      <section aria-label={`최근 ${label} 요약`} className="rise d1 grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
        <div className={statBox}>
          <p className={statKey}>등록된 자료</p>
          <p className={statVal}>{data.work.newDocuments}</p>
          <p className={statSub}>이 기간에 새로 들어간 자료</p>
        </div>
        <div className={statBox}>
          <p className={statKey}>학생 질문</p>
          <p className={statVal}>{data.stats.questions}</p>
          <p className={statSub}>
            강사 {data.stats.teachers}명 · 학생 {data.stats.students}명
          </p>
        </div>
        <div className={statBox}>
          <p className={statKey}>쓰고 있는 학생</p>
          <p className={statVal}>
            {data.stats.activeStudents}
            <span className="text-[14px] lg:text-[16px] font-semibold text-sub"> / {data.stats.students}명</span>
          </p>
          <p className={statSub} style={idle.length ? { color: "var(--red)" } : undefined}>
            {idle.length ? `${idle.length}명은 아직 안 써봤어요` : "전원 사용 중"}
          </p>
        </div>
        <div className={statBox}>
          <p className={statKey}>답변 평가</p>
          <p className={statVal}>
            <span className="text-blue">{data.stats.up}</span>
            <span className="text-[18px] text-sub font-semibold"> / </span>
            <span style={{ color: "var(--red)" }}>{data.stats.down}</span>
          </p>
          <p className={statSub}>도움됐어요 / 아쉬워요</p>
        </div>
      </section>

      {/* 누적 환산 — 강사 응대 시간을 얼마나 덜었는지 숫자로 */}
      <div className="rise d1 rounded-[12px] px-4 lg:px-5 py-3.5 lg:py-4 text-white bg-blue">
        <p className="text-[14px] lg:text-[15px] font-semibold">
          지금까지 답변 <b>{data.cumulative.answers.toLocaleString()}건</b> · 조교 약{" "}
          <b>{data.cumulative.hoursSaved}시간</b> 분량을 대신했어요
        </p>
        <p className="text-[12px] mt-1 opacity-75">
          답변 1건을 조교 응대 {data.cumulative.minutesPerAnswer}분으로 환산한 값이에요.
        </p>
      </div>

      {/* 일별 질문 추이 */}
      {data.daily.some((d) => d.count > 0) && (
        <section className="rise d2 card p-5 lg:p-6">
          <div className="flex items-baseline justify-between gap-2 mb-4 lg:mb-5">
            <h2 className={h2}>일별 질문 수</h2>
            <span className="text-sub text-[12px] lg:text-[13px]">
              최근 {label} · 최대 {maxDaily}건
            </span>
          </div>
          <div
            className={`flex items-end h-[110px] lg:h-40 ${few ? "gap-2.5 lg:gap-4" : "gap-[2px]"}`}
            role="img"
            aria-label={`최근 ${label} 일별 질문 수 막대 그래프`}
          >
            {data.daily.map((d, i) => (
              <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                  {md(d.date)} · {d.count}건
                </span>
                <div
                  className={`w-full bg-blue ${few ? "rounded-t-[6px] lg:rounded-t-[8px]" : "rounded-t-[3px]"}`}
                  style={{
                    height: `${(d.count / maxDaily) * 100}%`,
                    minHeight: d.count > 0 ? 3 : 0,
                    // 마지막 날(오늘)만 진하게
                    opacity: i === data.daily.length - 1 ? 1 : 0.25,
                  }}
                />
              </div>
            ))}
          </div>
          {few ? (
            <div className="flex gap-2.5 lg:gap-4 mt-2 text-center text-sub text-[11px] lg:text-[12px]">
              {data.daily.map((d) => (
                <span key={d.date} className="flex-1">
                  {md(d.date)}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex justify-between mt-2 text-sub text-[11px] lg:text-[12px]">
              <span>{data.daily[0] && md(data.daily[0].date)}</span>
              <span>{data.daily.at(-1) && md(data.daily.at(-1)!.date)}</span>
            </div>
          )}
        </section>
      )}

      {/* 바로 가기 — 손이 가야 할 곳(안 쓰는 학생·아쉬운 답변)을 요약과 함께 */}
      <nav aria-label="바로 가기" className="rise d2 card px-5 py-1 lg:grid lg:grid-cols-2 lg:gap-x-8">
        {shortcuts.map((m, i) => (
          <Link
            key={m.view}
            href={`/admin?v=${m.view}`}
            className={`flex items-center gap-3 py-3.5 ${i ? "border-t border-line" : ""} ${i === 1 ? "lg:border-t-0" : ""}`}
          >
            <span className="flex-1 min-w-0">
              <b className="block text-[16px]">{m.title}</b>
              <span className="text-[13px] text-sub" style={m.warn ? { color: "var(--red)" } : undefined}>
                {m.sub}
              </span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-sub shrink-0">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </nav>
        </>
      )}

        {/* 학생 참여 — "학생 N명"만으론 몇 명이 실제로 쓰는지 알 수 없다. 안 쓰는 학생이 해지 신호다. */}
        {view === "students" && (
        <section id="students" className="rise d2 card p-5 lg:p-6 scroll-mt-20 min-w-0">
          <h2 className={`${h2} mb-2`}>
            학생 {data.students.length}명 중 {data.stats.activeStudents}명 사용
          </h2>
          {data.students.length === 0 ? (
            <p className="text-sub text-[14px] py-4 text-center">아직 학생이 없어요.</p>
          ) : (
            data.students.map((s) => (
              <div key={s.id} className="border-t border-line">
                <button
                  onClick={() => toggleStudent(s.id)}
                  aria-expanded={openStu === s.id}
                  className="w-full flex items-center gap-3 py-3 text-left"
                >
                  <span className="avatar !w-9 !h-9 !text-[15px]">{avatarEmoji(s.name)}</span>
                  <span className="text-[15px] font-bold min-w-0 flex-1 truncate">{s.name}</span>
                  {s.questions === 0 ? (
                    <span
                      className="shrink-0 inline-flex items-center h-6 px-2 rounded-[6px] text-[12px] font-bold"
                      style={{ background: "var(--red-weak)", color: "var(--red)" }}
                    >
                      미사용
                    </span>
                  ) : (
                    <span className="text-[13px] text-sub shrink-0 text-right">
                      질문 {s.questions}건 · {ago(s.lastAt)}
                    </span>
                  )}
                </button>
                {openStu === s.id && (
                  <div
                    className="animate-pop mb-3 rounded-[12px] px-3.5 py-3 text-[13px] leading-relaxed"
                    style={{ background: "var(--fill-2)" }}
                  >
                    <p className="text-sub">
                      연락처 <b style={{ color: "var(--sub-2)" }}>{stuDetail[s.id]?.phone || "—"}</b>
                    </p>
                    <p className="text-sub mt-0.5">
                      메모{" "}
                      <span style={{ color: "var(--sub-2)" }}>
                        {stuDetail[s.id]?.note || "—"}
                      </span>
                    </p>
                    <p className="text-[11px] text-sub mt-1.5">
                      입력·수정은 강사 화면(학생별 리포트)에서 해요.
                    </p>
                    <button
                      className="mt-2 h-8 text-[13px] font-semibold"
                      style={{ color: "var(--red)" }}
                      onClick={() => {
                        setExpelMsg("");
                        setExpel({ id: s.id, name: s.name });
                      }}
                    >
                      학원에서 내보내기
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </section>
        )}

        {/* 강사 목록 */}
        {view === "teachers" && (
        <section id="teachers" className="rise d2 card p-5 lg:p-6 scroll-mt-20 min-w-0">
          <h2 className={`${h2} mb-2`}>소속 강사 {data.teachers.length}명</h2>
          {data.teachers.length === 0 ? (
            <p className="text-sub text-[14px] py-4 text-center">
              아직 강사가 없어요.{" "}
              <Link href="/admin?v=invite" className="text-blue font-semibold">
                강사 초대
              </Link>
              에서 링크를 공유해 보세요.
            </p>
          ) : (
            data.teachers.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-3.5 border-t border-line">
                <span className="avatar !w-10 !h-10 !text-[18px]">{avatarEmoji(t.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold truncate">
                    {t.name}
                    <span className="font-medium text-sub"> · {t.subject ?? "과목 미설정"}</span>
                    {!t.is_public && (
                      <span
                        className="ml-1.5 inline-flex items-center h-5 px-1.5 rounded-[6px] text-[11px] font-bold text-sub align-middle"
                        style={{ background: "var(--fill)" }}
                      >
                        비공개
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[13px] text-sub">
                    자료 {t.documents} · 질문 {t.questions}
                    {(t.up > 0 || t.down > 0) && (
                      <>
                        {" "}
                        · 도움됨 {t.up} · 아쉬움{" "}
                        <span style={t.down > 0 ? { color: "var(--red)", fontWeight: 700 } : undefined}>{t.down}</span>
                      </>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => togglePublic(t.id)}
                  className={`btn ${t.is_public ? "btn-gray" : "btn-ghost"} shrink-0 h-[34px] px-3 text-[13px]`}
                  title={t.is_public ? "학생 목록에서 숨기기" : "학생 목록에 공개하기"}
                >
                  {t.is_public ? "숨기기" : "공개하기"}
                </button>
              </div>
            ))
          )}
        </section>
        )}

        {/* 아쉬움 받은 답변 — 지금까지 숫자만 보여서 원장이 품질을 확인할 수 없었다 */}
        {view === "low-rated" && (
          <section id="low-rated" className="rise d3 card p-5 lg:p-6 scroll-mt-20 min-w-0">
            <h2 className={h2}>
              확인이 필요한 답변 <span style={{ color: "var(--red)" }}>{data.lowRated.length}</span>
            </h2>
            <p className="text-sub text-[13px] mt-1 mb-2">
              학생이 아쉬워요를 준 답변이에요. 관련 자료를 보강하면 좋아져요.
            </p>
            {data.lowRated.length === 0 && empty("이 기간에 아쉬워요를 받은 답변이 없어요.")}
            {data.lowRated.map((l, i) => (
              <details key={i} className="group border-t border-line py-3.5">
                <summary className="flex items-start gap-3 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">
                      <span className="text-blue">Q.</span> {l.question || "(제목 없음)"}
                    </span>
                    <span className="block mt-1 text-[13px] text-sub">
                      {l.teacher} · {md(l.created_at)}
                    </span>
                  </span>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0 text-sub transition-transform group-open:rotate-180">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </summary>
                <p
                  className="mt-2.5 rounded-[12px] px-3.5 py-3 text-[13px] text-sub leading-relaxed whitespace-pre-wrap"
                  style={{ background: "var(--fill-2)" }}
                >
                  {l.answer}…
                </p>
              </details>
            ))}
          </section>
        )}

        {/* 수강평 (학생 → 강사). 원장은 작성자 실명까지 본다 */}
        {view === "reviews" && (
          <section id="reviews" className="rise d3 card p-5 lg:p-6 scroll-mt-20 min-w-0">
            <h2 className={h2}>수강평 {rev?.reviews.length ?? 0}건</h2>
            <p className="text-sub text-[13px] mt-1">
              학생이 선생님에게 남긴 평가예요. 선생님 화면에는 이름 없이 보여요.
            </p>

            {!rev?.reviews.length && empty(rev ? "아직 수강평이 없어요." : "불러오는 중…")}
            <div className="flex flex-wrap gap-1.5 mt-3 mb-2">
              {rev?.byTeacher.map((t) => (
                <span
                  key={t.teacherId}
                  className="inline-flex items-center h-8 px-3 rounded-[8px] text-[13px] font-bold tabular-nums"
                  style={{ background: "var(--blue-weak)", color: "var(--blue)" }}
                >
                  {t.teacher} ★ {t.avg.toFixed(1)}
                  <span className="font-medium opacity-70 ml-1">· {t.count}개</span>
                </span>
              ))}
            </div>

            {rev?.reviews.slice(0, 20).map((r) => (
              <div key={r.id} className="border-t border-line py-3.5">
                {r.comment && <p className="text-[15px] leading-relaxed mb-1">{r.comment}</p>}
                <p className="text-[13px] text-sub">
                  {r.student} → {r.teacher} ·{" "}
                  <span style={{ color: "var(--blue)" }}>
                    {"★".repeat(r.rating)}
                    <span style={{ color: "var(--border)" }}>{"★".repeat(5 - r.rating)}</span>
                  </span>
                </p>
              </div>
            ))}
          </section>
        )}

        {/* 평가 결과 — 원장 화면엔 CSV 버튼이 없어 API로만 받을 수 있었다 (QZ-09) */}
        {view === "assessments" && (
          <section id="assessments" className="rise d3 card p-5 lg:p-6 scroll-mt-20 min-w-0">
            <h2 className={h2}>평가 결과 {data.assessments.length}건</h2>
            <p className="text-sub text-[13px] mt-1 mb-2">
              선생님들이 올린 평가예요. 응시 결과를 CSV로 내려받아 구글시트에 붙여넣을 수 있어요.
            </p>
            {csvMsg && (
              <p className="mb-2 text-[13px] font-semibold" style={{ color: "var(--red)" }}>
                {csvMsg}
              </p>
            )}
            {data.assessments.length === 0 && empty("아직 올라온 평가가 없어요.")}
            {data.assessments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-3.5 border-t border-line">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-bold truncate">{a.title}</p>
                  <p className="mt-0.5 text-[13px] text-sub">
                    {a.teacher} · {md(a.created_at)} · 응시 {a.attempts}명
                  </p>
                </div>
                <button
                  onClick={() => downloadResults(a.id, a.title)}
                  disabled={a.attempts === 0}
                  className="btn btn-ghost shrink-0 h-[34px] px-3 text-[13px]"
                >
                  CSV 받기
                </button>
              </div>
            ))}
          </section>
        )}

      {/* 강사 초대 */}
      {view === "invite" && (
      <section id="invite" className="rise d4 card p-5 lg:p-6 scroll-mt-20 flex flex-col gap-3">
        <div>
          <h2 className={h2}>강사 초대</h2>
          <p className="text-sub text-[14px] mt-1">
            QR이나 링크로 강사를 초대하세요. 가입하면 우리 학원 소속이 돼요.
          </p>
        </div>
        <InviteBox
          url={data.invite.url}
          qrSvg={data.invite.qrSvg}
          hint="강사가 회원가입 때 초대코드 칸에 넣어요"
        />
        <Link
          href="/ask"
          className="btn btn-gray h-11 px-[18px] text-[14px] inline-flex items-center justify-center sm:self-start"
        >
          학생 화면으로 보기 →
        </Link>
      </section>
      )}

      {/* 학생 제명 확인 — 화면에서 되돌릴 방법이 없어 한 번 더 묻는다 */}
      {expel && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-4"
          style={{ background: "rgba(0, 0, 0, 0.4)" }}
          onClick={() => !expelBusy && setExpel(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="expel-title"
            className="animate-pop card w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="expel-title" className="font-bold text-[17px] break-keep">
              {expel.name} 학생을 학원에서 내보낼까요?
            </h2>
            <ul className="mt-2 text-[14px] text-sub leading-relaxed list-disc pl-5 break-keep">
              <li>우리 학원 선생님 목록·질문·평가를 더 이상 쓸 수 없어요.</li>
              <li>학생 계정과 지금까지의 학습 기록은 지워지지 않아요.</li>
            </ul>
            {expelMsg && (
              <p className="mt-3 text-[13px] font-semibold" style={{ color: "var(--red)" }}>
                {expelMsg}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button className="btn btn-gray h-11 text-[15px]" onClick={() => setExpel(null)} disabled={expelBusy}>
                취소
              </button>
              <button
                className="btn h-11 text-[15px] text-white"
                style={{ background: "var(--red)" }}
                onClick={confirmExpel}
                disabled={expelBusy}
              >
                {expelBusy ? "처리 중…" : "내보내기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </div>
  );
}
