"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-store";

type Metrics = {
  generatedAt: string;
  users: { students: number; teachers: number; admins: number; academies: number; newUsers30: number };
  active: { dau: number; wau: number; mau: number };
  usage30: { conversations: number; questions: number; quizAttempts: number; bankAttempts: number; cbtSessions: number };
  totals: { conversations: number; documents: number };
  daily: { day: string; students: number; visits: number }[];
};

// 개발자 대시보드 — dev 계정 전용. 서비스 전반 지표(MAU·사용량)를 한 화면에.
export default function DevPage() {
  const { status, session, role } = useAuth();
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status !== "signed-in" || !session) return;
    fetch("/api/dev/metrics", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "불러오지 못했어요.");
        setM(d);
      })
      .catch((e) => setErr(e.message));
  }, [status, session]);

  if (status === "loading" || role === undefined) return <main className="flex-1" />;
  if (status !== "signed-in" || role !== "dev")
    return (
      <main className="flex-1 grid place-items-center px-5">
        <div className="text-center">
          <p className="text-[16px] font-bold mb-1">개발자 전용 화면이에요</p>
          <p className="text-sub text-[14px] mb-5">dev 계정으로 로그인해 주세요.</p>
          <Link href="/login" className="btn btn-primary py-3 px-6 inline-block">
            로그인
          </Link>
        </div>
      </main>
    );

  const maxVisits = Math.max(1, ...(m?.daily ?? []).map((d) => d.visits));

  const tile = (label: string, v: number | string, sub?: string) => (
    <div key={label} className="card p-4 text-center">
      <p className="text-[22px] font-extrabold tabular-nums">{v}</p>
      <p className="text-[12px] text-sub mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-sub">{sub}</p>}
    </div>
  );

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">개발자 대시보드</h1>
        <p className="text-sub text-[14px]">
          서비스 전반 지표예요. 활성 사용자(DAU·WAU·MAU)는 학생 접속 기록(v0.40.0~) 기준이에요.
        </p>
      </div>

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
      {!m && !err && <div className="skel h-40 !rounded-[20px]" />}

      {m && (
        <>
          <section className="rise d1 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">활성 사용자</h2>
            <div className="grid grid-cols-3 gap-2">
              {tile("DAU (오늘)", m.active.dau)}
              {tile("WAU (7일)", m.active.wau)}
              {tile("MAU (30일)", m.active.mau)}
            </div>
          </section>

          <section className="rise d2 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">일별 접속 (30일)</h2>
            <div className="card p-4">
              <div className="flex items-end gap-[2px] h-24">
                {m.daily.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day} · 접속 ${d.visits}회 · 학생 ${d.students}명`}
                    className="flex-1 rounded-t-[3px] bg-blue min-h-[2px]"
                    style={{ height: `${Math.max(2, (d.visits / maxVisits) * 100)}%`, opacity: d.visits ? 1 : 0.15 }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-sub mt-1.5">
                <span>{m.daily[0]?.day.slice(5)}</span>
                <span>{m.daily[m.daily.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          </section>

          <section className="rise d3 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">사용자</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {tile("학생", m.users.students)}
              {tile("강사", m.users.teachers)}
              {tile("원장", m.users.admins)}
              {tile("학원", m.users.academies)}
              {tile("신규 가입 (30일)", m.users.newUsers30)}
            </div>
          </section>

          <section className="rise d4 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">사용량 (최근 30일)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {tile("새 대화", m.usage30.conversations)}
              {tile("질문", m.usage30.questions)}
              {tile("연습문제 채점", m.usage30.quizAttempts)}
              {tile("기출 채점", m.usage30.bankAttempts)}
              {tile("CBT 응시", m.usage30.cbtSessions)}
            </div>
          </section>

          <section className="rise d5 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">누적</h2>
            <div className="grid grid-cols-2 gap-2">
              {tile("총 대화", m.totals.conversations)}
              {tile("등록 자료", m.totals.documents)}
            </div>
          </section>

          <p className="text-[11px] text-sub">
            집계 시각 {new Date(m.generatedAt).toLocaleString("ko-KR")} · 새로고침하면 다시 계산돼요.
          </p>
        </>
      )}
    </main>
  );
}
