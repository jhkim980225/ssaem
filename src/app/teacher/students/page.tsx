"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
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
  const [days, setDays] = useState(14);
  const [students, setStudents] = useState<Student[] | null>(null);

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

  if (!ready)
    return (
      <main className="flex-1 grid place-items-center">
        <div className="skel w-12 h-12 !rounded-full" />
      </main>
    );

  if (!session)
    return (
      <main className="flex-1 grid place-items-center px-5">
        <div className="text-center">
          <p className="text-sub mb-4">로그인이 필요해요.</p>
          <Link href="/teacher" className="btn btn-primary py-3 px-6 inline-block">
            강사 로그인
          </Link>
        </div>
      </main>
    );

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">학생별 리포트</h1>
        <p className="text-sub text-[14px]">최근 {days}일, 학생마다 얼마나 묻고 어디서 막혔는지예요.</p>
      </div>

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
          </div>
        ))}
      </div>
    </main>
  );
}
