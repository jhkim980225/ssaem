"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";

type Post = {
  id: string;
  courseId: string | null;
  course: string | null;
  title: string;
  body: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileUrl: string | null;
  createdAt: string;
};
type Course = { id: string; title: string };

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

// 자료 게시판 — RAG 학습 자료와 별개로, 학생이 그대로 내려받는 파일·공지.
export default function TeacherBoardPage() {
  const { session, gate, allowed } = useGate("teacher");
  const token = session?.access_token;

  const [posts, setPosts] = useState<Post[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [courseId, setCourseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!token) return;
    fetch("/api/board", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setPosts(d.posts ?? []))
      .catch(() => setPosts([]));
  }, [token]);

  useEffect(() => {
    if (!allowed || !token) return;
    load();
    fetch("/api/courses", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setCourses(d.courses ?? []))
      .catch(() => {});
  }, [allowed, token, load]);

  async function submit() {
    if (busy || !token) return;
    if (!title.trim()) return setErr("제목을 입력해 주세요.");
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const fd = new FormData();
      fd.append("title", title.trim());
      if (body.trim()) fd.append("body", body.trim());
      if (courseId) fd.append("courseId", courseId);
      const f = fileRef.current?.files?.[0];
      if (f) fd.append("file", f);
      const r = await fetch("/api/board", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "올리지 못했어요.");
      setTitle("");
      setBody("");
      if (fileRef.current) fileRef.current.value = "";
      setMsg("게시했어요. 학생 화면(질문하기)에 바로 보여요.");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, t: string) {
    if (!token) return;
    if (!confirm(`"${t}" 게시물을 삭제할까요? 첨부 파일도 함께 지워져요.`)) return;
    const r = await fetch(`/api/board?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) load();
    else setErr("삭제하지 못했어요 — 다시 시도해 주세요.");
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">자료 게시판</h1>
        <p className="text-sub text-[14px]">
          학생이 그대로 내려받는 파일·공지예요. AI 답변 근거로 쓰는 <b>학습 자료</b>와는 별개예요.
        </p>
      </div>

      {/* 새 게시물 */}
      <section className="rise d1 card p-5 flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold">새 게시물</h2>
        <input
          className="field"
          placeholder="제목 (예: 3주차 필기노트 PDF)"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="field"
          rows={3}
          placeholder="설명 (선택)"
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select className="field !py-2.5 !text-[14px] w-auto" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">공용 (내 학생 전체)</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} 전용
              </option>
            ))}
          </select>
          <input ref={fileRef} type="file" aria-label="첨부 파일" className="text-[13px]" />
        </div>
        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}
        {msg && <p className="text-[13px] font-bold text-blue">{msg}</p>}
        <button onClick={submit} disabled={busy} className="btn btn-primary py-3 disabled:opacity-50 lg:self-start lg:px-8">
          {busy ? "올리는 중…" : "게시하기"}
        </button>
        <p className="text-[12px] text-sub -mt-1">파일은 20MB까지. ROOM 전용을 고르면 그 강좌 학생에게만 보여요.</p>
      </section>

      {/* 목록 */}
      {posts === null && <div className="skel h-32 !rounded-[20px]" />}
      {posts && posts.length === 0 && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 게시물이 없어요</p>
          <p className="text-sub text-[13px]">필기노트·유인물·공지를 올려 보세요.</p>
        </div>
      )}
      {/* PC는 게시물 2열 — 제목·설명이 짧아 한 줄에 하나면 여백만 남는다 */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
        {(posts ?? []).map((p, i) => (
          <div key={p.id} className={`rise d${Math.min(i + 2, 6)} card p-4 lg:p-5 flex flex-col gap-2`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{p.course ?? "공용"}</span>
                  <span className="text-sub text-[12px]">
                    {new Date(p.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                  </span>
                </div>
                <p className="font-bold text-[15px] mt-1 break-words">{p.title}</p>
                {p.body && <p className="text-sub text-[13px] whitespace-pre-wrap break-words mt-0.5">{p.body}</p>}
              </div>
              <button onClick={() => remove(p.id, p.title)} className="chip !text-[12px] shrink-0" style={{ color: "var(--red)" }}>
                삭제
              </button>
            </div>
            {p.fileUrl && (
              <a href={p.fileUrl} className="chip !text-[13px] self-start" target="_blank" rel="noreferrer">
                📎 {p.fileName} {p.fileSize ? `(${fmtSize(p.fileSize)})` : ""}
              </a>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
