"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { avatarEmoji } from "@/lib/avatar";
import { useGate } from "@/components/RoleGuard";

type Teacher = { id: string; name: string; subject: string | null };
type QuizTotals = { attempted: number; wrong: number; correct: number };

// 학생 마이페이지 — 내 정보 + 흩어져 있던 기록(대화·오답노트·시험·수강평)을 한 화면에서 진입.
// 숫자는 기존 API를 그대로 세는 것이라 각 상세 화면과 항상 일치한다.
export default function MyPage() {
  const { session, gate, allowed } = useGate("student", { loginMessage: "내 정보와 학습 기록은 계정에 저장돼요." });

  const [profile, setProfile] = useState<{ name: string; academy: string | null } | null>(null);
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [convs, setConvs] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<QuizTotals | null>(null);
  const [exams, setExams] = useState<number | null>(null);
  const [visit, setVisit] = useState<{ total: number; days: number; streak: number } | null>(null);
  const [hw, setHw] = useState<number | null>(null);

  useEffect(() => {
    if (!allowed || !session) return;
    const h = { headers: { Authorization: `Bearer ${session.access_token}` } };
    fetch("/api/profile", h)
      .then((r) => r.json())
      .then((d) => setProfile(d.profile ?? null))
      .catch(() => setProfile(null));
    fetch("/api/teachers", h)
      .then((r) => r.json())
      .then((d) => setTeachers(d.teachers ?? []))
      .catch(() => setTeachers([]));
    fetch("/api/conversations", h)
      .then((r) => r.json())
      .then((d) => setConvs((d.conversations ?? []).length))
      .catch(() => setConvs(0));
    fetch("/api/quiz/attempt", h)
      .then((r) => r.json())
      .then((d) => setQuiz(d.totals ?? { attempted: 0, wrong: 0, correct: 0 }))
      .catch(() => setQuiz({ attempted: 0, wrong: 0, correct: 0 }));
    fetch("/api/bank/records", h)
      .then((r) => r.json())
      .then((d) => setExams((d.records ?? []).length))
      .catch(() => setExams(0));
    fetch("/api/visit", h)
      .then((r) => r.json())
      .then((d) => setVisit(typeof d.total === "number" ? d : { total: 0, days: 0, streak: 0 }))
      .catch(() => setVisit({ total: 0, days: 0, streak: 0 }));
    fetch("/api/submissions?mine=1", h)
      .then((r) => r.json())
      .then((d) => setHw((d.submissions ?? []).length))
      .catch(() => setHw(0));
  }, [allowed, session]);

  if (gate) return gate;

  const name = profile?.name ?? session?.user.user_metadata?.name ?? "";
  const loginId = (session?.user.email ?? "").split("@")[0];
  const joined = session?.user.created_at
    ? new Date(session.user.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : "";

  const menu = [
    { href: "/my/history", label: "대화내역", desc: "선생님과 나눈 질문·답변", n: convs },
    { href: "/quiz/notes", label: "오답노트", desc: "틀린 문제 기록 — 극복해도 남아요", n: quiz ? quiz.wrong : null },
    { href: "/my/records", label: "시험 기록", desc: "CBT 모의고사 응시 기록", n: exams },
    { href: "/my/reviews", label: "선생님 평가", desc: "수강평 남기기·수정", n: null },
  ];

  // 메뉴 오른쪽 화살표 — 시안의 › 를 선 아이콘으로
  const chevron = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-sub shrink-0" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-4xl mx-auto px-4 pt-3 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <div className="rise flex flex-col gap-1 px-1 min-h-[48px] justify-center lg:min-h-0">
        <h1 className="text-[22px] lg:text-[28px] font-bold">마이</h1>
        <p className="hidden lg:block text-sub text-[14px]">내 정보와 학습 기록을 한 곳에서 봐요.</p>
      </div>

      {/* PC에선 좌(내 정보·내 선생님) / 우(요약·기록) 2단 — 모바일 기둥 방지.
          모바일은 래퍼를 contents로 풀고 order로 시안 순서(프로필·출석·숫자·메뉴·선생님)를 만든다 */}
      <div className="flex flex-col gap-3 lg:gap-4 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
      <div className="contents lg:flex lg:flex-col lg:gap-4 lg:sticky lg:top-[76px]">
      {/* 내 정보 */}
      <section className="rise d1 order-1 card p-5 flex items-center gap-3.5">
        <span className="grid place-items-center w-14 h-14 shrink-0 rounded-full bg-blue text-white text-[22px] font-bold">
          {avatarEmoji(name || loginId)}
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          <p className="text-[19px] font-bold truncate">{name || loginId}</p>
          {/* truncate 금지 — 320px 좌열에서 가입일이 잘린다. 줄바꿈으로 전부 보여준다 */}
          <p className="text-sub text-[13px] break-keep">
            아이디 {loginId}
            {profile?.academy ? ` · ${profile.academy}` : ""}
            {joined ? ` · ${joined} 가입` : ""}
          </p>
        </div>
        <Link href="/my/account" className="chip shrink-0 ml-auto !text-[13px]">
          수정
        </Link>
      </section>

      {/* 출석 */}
      <section className="rise d1 order-2 card p-5 flex items-center gap-3.5">
        <span className="grid place-items-center w-12 h-12 shrink-0 rounded-[12px] text-[24px]" style={{ background: "var(--fill)" }} aria-hidden>
          🔥
        </span>
        <div className="min-w-0 flex-1 flex flex-col gap-0.5">
          {visit === null ? (
            <div className="skel h-9 !rounded-[10px]" />
          ) : visit.days === 0 ? (
            <>
              <p className="text-[18px] font-bold">출석</p>
              <p className="text-sub text-[13px]">오늘부터 출석이 기록돼요. 매일 들어와서 이어가 보세요.</p>
            </>
          ) : (
            <>
              <p className="text-[18px] font-bold">
                {visit.streak > 0 ? `${visit.streak}일 연속 출석 중` : "오늘 출석하면 이어져요"}
              </p>
              <p className="text-sub text-[13px]">
                총 방문 {visit.total}회 · 출석일 {visit.days}일
              </p>
            </>
          )}
        </div>
      </section>

      {/* 내 선생님 */}
      <section className="rise d4 order-5 card p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[16px] font-bold">내 선생님</h2>
          {teachers && teachers.length > 0 && (
            <Link href="/my/courses" className="text-sub text-[13px] font-semibold hover:underline">
              수강 관리
            </Link>
          )}
        </div>
        {teachers === null && <div className="skel h-10 !rounded-[10px]" />}
        {teachers && teachers.length === 0 && (
          <p className="text-sub text-[13px]">
            아직 연결된 선생님이 없어요.{" "}
            <Link href="/ask" className="text-blue font-bold hover:underline">
              질문하기
            </Link>
            에서 선생님 코드를 입력하면 연결돼요.
          </p>
        )}
        {teachers && teachers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {teachers.map((t) => (
              <Link key={t.id} href={`/ask?teacher=${t.id}`} className="chip !text-[14px] !border-transparent" style={{ background: "var(--fill-2)", color: "var(--text)" }}>
                {t.name}
                {t.subject ? ` · ${t.subject}` : ""}
              </Link>
            ))}
          </div>
        )}
      </section>
      </div>

      <div className="contents lg:flex lg:flex-col lg:gap-4">
      {/* 학습 요약 */}
      <section className="rise d2 order-3 card p-5 grid grid-cols-3 sm:grid-cols-5 gap-x-2 gap-y-4 text-center">
        {(
          [
            ["대화", convs],
            ["푼 문제", quiz ? quiz.attempted : null],
            ["남은 오답", quiz ? quiz.wrong : null],
            ["시험 응시", exams],
            ["과제 제출", hw],
          ] as const
        ).map(([label, n]) => (
          <div key={label}>
            {n === null ? (
              <span className="skel h-7 w-10 mx-auto block !rounded-md" aria-hidden />
            ) : (
              <p
                className="text-[20px] font-bold tabular-nums"
                style={label === "남은 오답" && n > 0 ? { color: "var(--red)" } : undefined}
              >
                {n}
              </p>
            )}
            <p className="text-[13px] text-sub mt-0.5">{label}</p>
          </div>
        ))}
      </section>

      {/* 기록 바로가기 */}
      <section className="rise d3 order-4 card py-1.5">
        {menu.map((m) => (
          <Link key={m.href} href={m.href} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-[var(--fill-2)] transition-colors">
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold">{m.label}</p>
              <p className="text-sub text-[13px] truncate">{m.desc}</p>
            </div>
            {m.n !== null && m.n !== undefined && m.n > 0 && (
              <span className="text-sub text-[14px] shrink-0 tabular-nums">{m.n}</span>
            )}
            {chevron}
          </Link>
        ))}
      </section>
      </div>
      </div>
    </main>
  );
}
