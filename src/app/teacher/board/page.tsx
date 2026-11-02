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

  const LABEL = "flex flex-col gap-2 text-[13px] font-semibold";

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">자료 게시판</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">
          학생이 그대로 내려받는 파일·공지예요. AI 답변 근거로 쓰는 <b>학습 자료</b>와는 별개예요.
        </p>
      </div>

      {/* 새 게시물 */}
      <section className="rise d1 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px] lg:text-[19px] mb-1">새 게시물</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={LABEL} style={{ color: "var(--sub-2)" }}>
            제목
            <input
              className="field"
              placeholder="예: 3주차 필기노트 PDF"
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className={LABEL} style={{ color: "var(--sub-2)" }}>
            공개 범위
            <select className="field" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">공용 (내 학생 전체)</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} 전용
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={LABEL} style={{ color: "var(--sub-2)" }}>
          설명 (선택)
          <textarea
            className="field resize-y"
            rows={3}
            placeholder="학생에게 보일 설명"
            maxLength={4000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {/* 첨부 — 네이티브 파일 입력을 점선 영역 안에 둔다 (끌어다 놓기도 입력 위에서 동작) */}
        <label
          className="rounded-[12px] border border-dashed border-[var(--border-strong)] px-4 py-5 flex flex-col items-center justify-center gap-2 text-center cursor-pointer"
          style={{ color: "var(--sub-2)" }}
        >
          <span className="text-[15px] font-bold">파일을 끌어다 놓거나 눌러서 고르기</span>
          <span className="text-[13px] text-sub">20MB까지 · ROOM 전용을 고르면 그 강좌 학생에게만 보여요</span>
          <input ref={fileRef} type="file" aria-label="첨부 파일" className="text-[13px] max-w-full" />
        </label>
        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}
        {msg && <p className="text-[13px] font-bold text-blue">{msg}</p>}
        <button onClick={submit} disabled={busy} className="btn btn-primary h-12 px-6 sm:self-end disabled:opacity-50">
          {busy ? "올리는 중…" : "게시하기"}
        </button>
      </section>

      {/* 목록 */}
      {posts === null && <div className="skel h-32 !rounded-[16px]" />}
      {posts && posts.length === 0 && (
        <div className="rise d2 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 게시물이 없어요</p>
          <p className="text-sub text-[13px]">필기노트·유인물·공지를 올려 보세요.</p>
        </div>
      )}
      {/* PC는 게시물 2열 — 제목·설명이 짧아 한 줄에 하나면 여백만 남는다 */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {(posts ?? []).map((p, i) => (
          <article key={p.id} className={`rise d${Math.min(i + 2, 6)} card !rounded-[14px] p-5 flex flex-col gap-2.5 min-w-0`}>
            <div className="flex items-center justify-between gap-2">
              <span
                className="inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold"
                style={p.course ? { background: "var(--blue-weak)", color: "var(--blue)" } : { background: "var(--fill)", color: "var(--sub-2)" }}
              >
                {p.course ?? "공용"}
              </span>
              <span className="text-sub text-[13px]">
                {new Date(p.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
              </span>
            </div>
            <p className="font-bold text-[16px] lg:text-[17px] break-words">{p.title}</p>
            {p.body && (
              <p className="text-[14px] whitespace-pre-wrap break-words" style={{ color: "var(--sub-2)" }}>
                {p.body}
              </p>
            )}
            {p.fileUrl && (
              <a
                href={p.fileUrl}
                className="flex items-center gap-2.5 rounded-[10px] p-3 min-w-0 hover:underline"
                style={{ background: "var(--fill-2)" }}
                target="_blank"
                rel="noreferrer"
              >
                <span aria-hidden>📎</span>
                <span className="flex-1 min-w-0 truncate text-[14px] font-semibold">{p.fileName}</span>
                {p.fileSize ? <span className="text-sub text-[13px] shrink-0">{fmtSize(p.fileSize)}</span> : null}
              </a>
            )}
            <button
              onClick={() => remove(p.id, p.title)}
              className="btn h-9 px-3 text-[13px] font-semibold self-end hover:bg-[var(--red-weak)]"
              style={{ color: "var(--red)" }}
            >
              삭제
            </button>
          </article>
        ))}
      </div>
    </main>
  );
}
