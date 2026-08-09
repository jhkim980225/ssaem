"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/lib/role";
import { RoleLoading, WrongRole, NeedLogin } from "@/components/RoleGuard";
import { avatarEmoji } from "@/lib/avatar";

type Student = {
  id: string;
  name: string;
  questions: number;
  down: number;
  lastQuestion: string;
  lastAt: string;
};

// 학생별 리포트 (Khanmigo 교사 리포트 패턴) — 누가 얼마나 묻는지, 어디서 막히는지.
export default function StudentsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const role = useRole(session);
  const [days, setDays] = useState(14);
  const [students, setStudents] = useState<Student[] | null>(null);
  // 초기화 결과는 한 번만 내려오므로(저장 안 함) 화면에 띄워두고 강사가 학생에게 전달한다
  const [issued, setIssued] = useState<{ id: string; loginId: string; password: string } | null>(null);
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    fetch("/api/students", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => {
        setDays(d.days ?? 14);
        setStudents(d.students ?? []);
      })
      .catch(() => setStudents([]));
  }, [session]);

  async function resetPw(studentId: string, name: string) {
    if (!session) return;
    if (!confirm(`${name} 학생의 비밀번호를 임시 비밀번호로 바꿀까요?
지금 쓰던 비밀번호는 즉시 못 쓰게 돼요.`)) return;
    setBusy(studentId);
    setPwErr("");
    setIssued(null);
    const r = await fetch("/api/students/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ studentId }),
    });
    const d = await r.json().catch(() => null);
    setBusy(null);
    if (!r.ok) return setPwErr(d?.error ?? "초기화하지 못했어요.");
    setIssued({ id: studentId, loginId: d.loginId, password: d.password });
  }

  if (!ready) return <RoleLoading />;

  if (!session) return <NeedLogin as="teacher" />;
  if (role === undefined) return <RoleLoading />;
  if (role !== "teacher") return <WrongRole need="teacher" role={role} />;

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">학생별 리포트</h1>
        <p className="text-sub text-[14px]">최근 {days}일, 학생마다 얼마나 묻고 어디서 막혔는지예요.</p>
      </div>

      {pwErr && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {pwErr}
        </p>
      )}

      {students === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-20 !rounded-[20px]" />
          ))}
        </div>
      )}

      {students?.length === 0 && (
        <div className="rise d1 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 로그인한 학생의 질문이 없어요</p>
          <p className="text-sub text-[13px]">
            학생이 로그인하고 질문하면 여기에 쌓여요. 초대 링크를 공유해 보세요.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {students?.map((s, i) => (
          <div key={s.id} className={`rise d${Math.min(i + 1, 6)} card p-4 lg:p-5`}>
            <div className="flex items-center gap-3">
              <span className="avatar !w-10 !h-10 !text-[16px]">{avatarEmoji(s.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold truncate">{s.name}</p>
                <p className="text-[13px] text-sub truncate">
                  최근 질문: {s.lastQuestion || "—"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[15px] font-extrabold tabular-nums">질문 {s.questions}</p>
                {s.down > 0 && (
                  <p className="text-[12px] font-bold" style={{ color: "var(--red)" }}>
                    아쉬움 {s.down}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end">
              <button
                onClick={() => resetPw(s.id, s.name)}
                disabled={busy === s.id}
                className="chip !py-1 !px-2.5 !text-[12px] disabled:opacity-50"
              >
                {busy === s.id ? "바꾸는 중…" : "비밀번호 초기화"}
              </button>
            </div>

            {issued?.id === s.id && (
              <div
                className="animate-pop mt-3 rounded-[14px] p-4 text-[13px] leading-relaxed"
                style={{ background: "var(--blue-weak)" }}
              >
                <p className="font-extrabold text-blue mb-1.5">임시 비밀번호를 학생에게 알려주세요</p>
                <p style={{ color: "var(--sub-2)" }}>
                  아이디 <b className="tabular-nums">{issued.loginId}</b>
                  <br />
                  임시 비밀번호 <b className="tabular-nums">{issued.password}</b>
                </p>
                <p className="mt-2 text-sub text-[12px]">
                  이 화면을 벗어나면 다시 볼 수 없어요. 학생이 로그인한 뒤 비밀번호를 바꾸도록 안내해 주세요.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
