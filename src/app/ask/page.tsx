"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ChatPanel from "@/components/ChatPanel";

type Teacher = { id: string; name: string; subject: string | null };

export default function AskPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/teachers")
      .then((r) => r.json())
      .then((d) => setTeachers(d.teachers ?? []))
      .catch(() => setErr("선생님 목록을 불러오지 못했어요"));
  }, []);

  const active = teachers.find((t) => t.id === teacherId);

  return (
    <main className="flex-1 w-full max-w-lg mx-auto px-5 py-8 flex flex-col gap-4">
      <div>
        <Link href="/" className="text-sub text-[13px]">
          ← 홈
        </Link>
        <h1 className="text-[24px] font-extrabold">질문하기</h1>
        <p className="text-sub text-[14px]">선생님을 고르고 궁금한 걸 물어보세요.</p>
      </div>

      {err && <p className="text-[13px]" style={{ color: "var(--red)" }}>{err}</p>}

      {/* 강사 선택 */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {teachers.length === 0 && <p className="text-sub text-[14px] py-2">등록된 선생님이 없어요.</p>}
        {teachers.map((t) => (
          <button
            key={t.id}
            onClick={() => setTeacherId(t.id)}
            className={`chip shrink-0 ${teacherId === t.id ? "chip-on" : ""}`}
          >
            {t.name}
            {t.subject ? ` · ${t.subject}` : ""}
          </button>
        ))}
      </div>

      {active ? (
        <div className="card p-5 animate-pop">
          <ChatPanel teacherId={active.id} teacherName={active.name} />
        </div>
      ) : (
        teachers.length > 0 && (
          <div className="card p-8 text-center text-sub text-[14px]">위에서 선생님을 선택하세요.</div>
        )
      )}
    </main>
  );
}
