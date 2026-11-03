"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { avatarEmoji } from "@/lib/avatar";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";

type Enr = { course_id: string; title: string; teacher_id: string | null; teacher_name: string | null; joined_at: string };

// 학생 수강 관리 — 연결된 ROOM 목록과 해지. 해지는 연결만 끊고 학습 기록은 남긴다.
export default function MyCoursesPage() {
  const { session, gate, allowed } = useGate("student", { loginMessage: "수강 정보는 계정에 저장돼요." });
  const token = session?.access_token;
  const [list, setList] = useState<Enr[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!allowed || !token) return;
    fetch("/api/enrollments", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setList(d.enrollments ?? []))
      .catch(() => setList([]));
  }, [allowed, token]);

  if (gate) return gate;

  async function leave(e: Enr) {
    if (busy) return;
    const who = e.teacher_name ? `${e.teacher_name} 선생님 · ` : "";
    if (
      !confirm(
        `${who}${e.title} 수강을 해지할까요?\n이 반 자료·공지가 더 이상 안 보여요. 대화·시험·오답 기록은 남고, 코드를 다시 입력하면 돌아올 수 있어요.`
      )
    )
      return;
    setBusy(e.course_id);
    setErr("");
    try {
      const r = await fetch(`/api/enrollments?course=${e.course_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setErr(d?.error || "해지하지 못했어요.");
      else setList((l) => (l ?? []).filter((x) => x.course_id !== e.course_id));
    } catch {
      setErr("네트워크 오류로 해지하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex-1 w-full max-w-lg mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center">
        <BackButton fallback="/my" />
      </header>
      <section className="rise px-1 pb-1">
        <h1 className="text-[24px] lg:text-[28px] font-bold mb-1.5">수강 관리</h1>
        <p className="text-sub text-[15px] break-keep">선생님 코드로 연결된 반이에요. 해지해도 학습 기록은 남아요.</p>
      </section>

      {err && (
        <p role="alert" className="text-[13px] font-bold px-1" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {list === null && (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="skel h-16 !rounded-[16px]" />
          ))}
        </div>
      )}

      {list?.length === 0 && (
        <section className="rise d1 card p-5 text-center flex flex-col gap-2">
          <p className="text-[16px] font-bold">연결된 반이 없어요</p>
          <p className="text-sub text-[14px] break-keep">
            <Link href="/ask" className="text-blue font-bold hover:underline">
              질문하기
            </Link>
            에서 선생님 코드를 입력하면 연결돼요.
          </p>
        </section>
      )}

      {list && list.length > 0 && (
        <section className="rise d1 card py-1 overflow-hidden">
          {list.map((e, i) => (
            <article key={e.course_id} className={`px-5 py-4 flex items-center gap-3 ${i > 0 ? "border-t border-line" : ""}`}>
              <span className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-blue text-white font-bold">
                {avatarEmoji(e.teacher_name ?? "선생님")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-[16px] truncate">{e.title}</p>
                <p className="text-sub text-[13px] truncate mt-0.5">
                  {e.teacher_name ?? "선생님"} ·{" "}
                  {new Date(e.joined_at).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" })} 연결
                </p>
              </div>
              <button
                onClick={() => leave(e)}
                disabled={busy !== null}
                className="btn btn-gray shrink-0 h-9 px-3.5 text-[13px]"
              >
                {busy === e.course_id ? "해지 중…" : "해지"}
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
