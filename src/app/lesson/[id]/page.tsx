"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";

type Lesson = {
  id: string;
  title: string;
  summary: string | null;
  date: string;
  course: string | null;
  teacherName: string | null;
};

// 수업 상세 — 달력 카드(좁은 레일)에선 요약을 읽기 힘들어 전체를 펼쳐 보는 전용 화면.
// 강사·학생 공용: 접근 가능 여부는 API가 판단한다 (강사=본인 자료, 학생=수강 ROOM+공용).
export default function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { session, role, gate, allowed } = useGate("any", {
    loginMessage: "수업 내용은 로그인 후 볼 수 있어요.",
  });
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed || !session) return;
    fetch(`/api/lessons/${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok && d?.lesson) setLesson(d.lesson);
        else setErr(d?.error === "not found" ? "수업을 찾을 수 없거나 볼 수 없는 수업이에요." : d?.error ?? "불러오지 못했어요.");
      })
      .catch(() => setErr("불러오지 못했어요."));
  }, [allowed, session, id]);

  if (gate) return gate;

  const home = role === "teacher" || role === "admin" ? "/teacher" : "/ask";
  const fmtDate = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${y}년 ${+m}월 ${+d}일`;
  };

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-5xl mx-auto px-6 lg:px-5 py-4 lg:py-8 flex flex-col gap-4">
      <div className="rise">
        <BackButton fallback={home} />
      </div>

      {err && (
        <section className="rise d1 card p-5 flex flex-col gap-3 lg:max-w-2xl">
          <p className="text-sub text-[14px]">{err}</p>
          <Link href={home} className="btn btn-gray py-2 px-5 self-start text-[13px]">
            돌아가기
          </Link>
        </section>
      )}

      {/* PC는 본문 + 우측 정보 레일 2컬럼 (teacher 대시보드와 같은 구조), 모바일은 카드 없이 세로 스택 */}
      {!lesson && !err && (
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-5 lg:items-start flex flex-col gap-4">
          <div className="rise d1 skel h-64 !rounded-[16px]" />
          <div className="rise d1 skel h-32 !rounded-[16px] hidden lg:block" />
        </div>
      )}

      {lesson && (
        <div className="lg:grid lg:grid-cols-[1fr_300px] lg:gap-5 lg:items-start flex flex-col gap-7">
          <section className="rise d1 lg-card lg:p-7 flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="rounded-[8px] h-7 px-2.5 flex items-center text-[13px] font-bold text-blue" style={{ background: "var(--blue-weak)" }}>
                {fmtDate(lesson.date)} 수업
              </span>
              <span className="rounded-[8px] h-7 px-2.5 flex items-center text-[13px] font-semibold" style={{ background: "var(--fill)", color: "var(--sub-2)" }}>
                {lesson.course ?? "공용"}
              </span>
            </div>
            <h1 className="mt-3.5 font-bold text-[24px] lg:text-[26px] leading-[1.4] tracking-tight break-words whitespace-pre-wrap">
              {lesson.title}
            </h1>
            {lesson.summary ? (
              <div className="mt-6 rounded-[14px] p-5 border border-line lg:border-transparent" style={{ background: "var(--fill-2)" }}>
                <p className="flex items-center gap-1.5 text-blue text-[14px] font-bold mb-2.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
                  </svg>
                  AI 요약
                </p>
                <p className="text-[16px] leading-[1.75] break-words whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                  {lesson.summary}
                </p>
              </div>
            ) : (
              <p className="mt-6 text-sub text-[14px]">이 수업엔 아직 정리된 요약이 없어요.</p>
            )}
          </section>

          <aside className="rise d2 lg-card lg:p-5 flex flex-col gap-4">
            <div>
              <h2 className="font-bold text-[16px] mb-1.5">수업 정보</h2>
              <dl className="flex flex-col text-[15px] lg:text-[14px]">
                <div className="flex justify-between gap-2 py-3.5 lg:py-2.5 border-b border-line">
                  <dt className="text-sub shrink-0">날짜</dt>
                  <dd className="font-semibold text-right">{fmtDate(lesson.date)}</dd>
                </div>
                <div className={`flex justify-between gap-2 py-3.5 lg:py-2.5 ${lesson.teacherName ? "border-b border-line" : ""}`}>
                  <dt className="text-sub shrink-0">강좌</dt>
                  <dd className="font-semibold text-right">{lesson.course ?? "공용"}</dd>
                </div>
                {lesson.teacherName && (
                  <div className="flex justify-between gap-2 py-3.5 lg:py-2.5">
                    <dt className="text-sub shrink-0">선생님</dt>
                    <dd className="font-semibold text-right">{lesson.teacherName}</dd>
                  </div>
                )}
              </dl>
            </div>
            <Link
              href={home}
              className="btn btn-primary w-full h-[50px] lg:h-11 flex items-center justify-center text-[17px] lg:text-[14px]"
            >
              {role === "teacher" || role === "admin" ? "대시보드로" : "질문하러 가기"}
            </Link>
          </aside>
        </div>
      )}
    </main>
  );
}
