"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ChatPanel from "@/components/ChatPanel";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = { id: string; name: string; subject: string | null };

export default function AskPage() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null); // null = 로딩
  const [teacherId, setTeacherId] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/teachers")
      .then((r) => r.json())
      .then((d) => setTeachers(d.teachers ?? []))
      .catch(() => {
        setErr("선생님 목록을 불러오지 못했어요");
        setTeachers([]);
      });
  }, []);

  const active = teachers?.find((t) => t.id === teacherId);

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise">
        <Link href="/" className="text-sub text-[13px]">
          ← 홈
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">질문하기</h1>
        <p className="text-sub text-[14px]">선생님을 고르고 궁금한 걸 물어보세요.</p>
      </div>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-5 lg:items-start flex flex-col gap-4">
        {/* PC: 좌측 리스트 / 모바일: 가로 칩 스크롤 */}
        <div className="rise d1 lg-card lg:p-3">
          {/* 로딩 스켈레톤 */}
          {teachers === null && (
            <>
              <div className="hidden lg:flex flex-col gap-2 p-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-2">
                    <div className="skel w-[42px] h-[42px] !rounded-full" />
                    <div className="flex-1 flex flex-col gap-1.5">
                      <div className="skel h-3.5 w-2/5" />
                      <div className="skel h-3 w-3/5" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex lg:hidden gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel h-9 w-28 !rounded-full shrink-0" />
                ))}
              </div>
            </>
          )}

          {teachers?.length === 0 && (
            <p className="text-sub text-[14px] py-2 lg:p-3">등록된 선생님이 없어요.</p>
          )}

          {/* PC 세로 리스트 */}
          <div className="hidden lg:flex flex-col gap-1">
            {teachers?.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeacherId(t.id)}
                className={`t-item ${teacherId === t.id ? "t-item-on" : ""}`}
              >
                <span className="avatar">{avatarEmoji(t.name)}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold truncate">{t.name}</span>
                  {t.subject && (
                    <span className="block text-[13px] text-sub truncate">{t.subject}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* 모바일 가로 칩 */}
          <div className="flex lg:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {teachers?.map((t) => (
              <button
                key={t.id}
                onClick={() => setTeacherId(t.id)}
                className={`chip shrink-0 ${teacherId === t.id ? "chip-on" : ""}`}
              >
                {avatarEmoji(t.name)} {t.name}
                {t.subject ? ` · ${t.subject}` : ""}
              </button>
            ))}
          </div>
        </div>

        {/* 채팅 영역 */}
        {active ? (
          <div key={active.id} className="animate-pop card p-4 lg:p-6 lg:min-h-[62vh] flex flex-col">
            <ChatPanel teacherId={active.id} teacherName={active.name} />
          </div>
        ) : (
          (teachers?.length ?? 0) > 0 && (
            <div className="rise d2 card p-10 lg:min-h-[62vh] grid place-items-center text-center">
              <div>
                <p className="text-[34px] mb-3">👋</p>
                <p className="text-sub text-[14px]">선생님을 선택하세요.</p>
              </div>
            </div>
          )
        )}
      </div>
    </main>
  );
}
