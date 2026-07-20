"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ChatPanel from "@/components/ChatPanel";

type Doc = {
  id: string;
  kind: string;
  title: string | null;
  source: string;
  preview: string;
  chunks: number;
  created_at: string;
};

type DocEvent = {
  id: string;
  action: "created" | "deleted";
  title: string | null;
  kind: string | null;
  source: string | null;
  chunks: number;
  created_at: string;
};

export default function TeacherPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready)
    return (
      <main className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-3">
          <div className="skel w-12 h-12 !rounded-full" />
          <div className="skel h-3.5 w-24" />
        </div>
      </main>
    );
  return (
    <main className={`flex-1 w-full mx-auto px-5 py-8 ${session ? "max-w-lg lg:max-w-6xl" : "max-w-lg"}`}>
      {session ? <Dashboard session={session} /> : <AuthForm />}
    </main>
  );
}

function AuthForm() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [msg, setMsg] = useState("");

  async function submit() {
    setMsg("");
    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password: pw })
        : await supabase.auth.signUp({ email, password: pw });
    if (error) setMsg(error.message);
    else if (mode === "signup") setMsg("가입 완료. 메일 확인 후 로그인해 주세요.");
  }

  return (
    <div className="animate-pop flex flex-col gap-3 max-w-sm mx-auto mt-10">
      <Link href="/" className="rise text-sub text-[14px] mb-2">
        ← 홈
      </Link>
      <h1 className="rise d1 text-[26px] font-extrabold">강사 {mode === "login" ? "로그인" : "가입"}</h1>
      <p className="rise d2 text-sub text-[14px] mb-3">계정으로 나만의 AI 튜터를 관리해요.</p>
      <input className="field" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field" type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button onClick={submit} className="btn btn-primary py-4 mt-1">
        {mode === "login" ? "로그인" : "가입하기"}
      </button>
      <button
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
        className="text-sub text-[14px] mt-1"
      >
        {mode === "login" ? "계정이 없나요? 가입하기" : "이미 계정이 있나요? 로그인"}
      </button>
      {msg && <p className="text-[13px] text-blue mt-1">{msg}</p>}
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const token = session.access_token;
  const uid = session.user.id;

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [tone, setTone] = useState("");
  const [savedProfile, setSavedProfile] = useState(false);

  const [kind, setKind] = useState<"problem" | "style">("problem");
  const [content, setContent] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [events, setEvents] = useState<DocEvent[]>([]);
  const [msg, setMsg] = useState("");

  const loadDocs = useCallback(async () => {
    const [dr, er] = await Promise.all([
      fetch("/api/documents", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/documents/events", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const d = await dr.json();
    if (dr.ok) setDocs(d.documents ?? []);
    const e = await er.json();
    if (er.ok) setEvents(e.events ?? []);
  }, [token]);

  useEffect(() => {
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setName(d.profile.name ?? "");
          setSubject(d.profile.subject ?? "");
          setTone(d.profile.tone_note ?? "");
          setSavedProfile(true);
        }
      })
      .catch(() => {});
    loadDocs();
  }, [token, loadDocs]);

  async function saveProfile() {
    setMsg("");
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, subject, tone_note: tone }),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || "저장 실패");
    else {
      setSavedProfile(true);
      setMsg("프로필 저장됨");
    }
  }

  async function removeDoc(id: string) {
    const r = await fetch(`/api/documents?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) loadDocs();
    else setMsg("삭제 실패");
  }

  async function uploadPdf(file: File) {
    setMsg("PDF 처리 중…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || "업로드 실패");
    else {
      setMsg(`PDF 등록됨: ${d.chars}자 → ${d.chunks}청크`);
      loadDocs();
    }
  }

  async function addDoc() {
    if (!content.trim()) return;
    setMsg("");
    const r = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, content }),
    });
    const d = await r.json();
    if (!r.ok) setMsg(d.error || "실패");
    else {
      setContent("");
      setMsg(`추가됨 (${d.chunks}청크)`);
      loadDocs();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex justify-between items-center">
        <div>
          <Link href="/" className="text-sub text-[13px]">
            ← 홈
          </Link>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">강사 대시보드</h1>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="chip">
          로그아웃
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-5 lg:items-start flex flex-col gap-4">
      <div className="flex flex-col gap-4 min-w-0">
      {/* 프로필 */}
      <section className="rise d1 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">
          내 프로필 {!savedProfile && <span className="text-blue text-[13px]">· 먼저 저장하세요</span>}
        </h2>
        <input className="field" placeholder="이름 (학생에게 표시)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field" placeholder="과목 (예: 전산회계 2급)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="field min-h-24 resize-none"
          placeholder="말투/톤 지시 (예: 존댓말, 유머 섞기, 단계별로 차분히 설명)"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        />
        <button onClick={saveProfile} className="btn btn-primary py-3 self-start px-6">
          프로필 저장
        </button>
      </section>

      {/* 자료 */}
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">학습 자료</h2>
        <div className="flex gap-2">
          <button onClick={() => setKind("problem")} className={`chip ${kind === "problem" ? "chip-on" : ""}`}>
            문제·풀이
          </button>
          <button onClick={() => setKind("style")} className={`chip ${kind === "style" ? "chip-on" : ""}`}>
            말투 샘플
          </button>
        </div>
        <textarea
          className="field min-h-28 resize-none"
          placeholder={kind === "problem" ? "문제와 풀이를 붙여넣으세요" : "평소 설명하는 말투 예시를 붙여넣으세요"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={addDoc} className="btn btn-primary py-3 px-6">
            텍스트 추가
          </button>
          <label className="btn btn-gray py-3 px-5 cursor-pointer">
            PDF 업로드
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPdf(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {msg && <p className="text-[13px] text-blue">{msg}</p>}

        {docs.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-sub text-[13px]">
              등록된 자료 {docs.length}개 · 청크 {docs.reduce((s, d) => s + d.chunks, 0)}개
            </p>
            {docs.map((d) => (
              <div key={d.id} className="flex justify-between gap-2 rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
                <div className="text-[14px] min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="chip !py-0.5 !px-2 !text-[11px]">
                      {d.kind === "style" ? "말투" : "문제"}
                    </span>
                    {d.source === "pdf" && <span className="chip !py-0.5 !px-2 !text-[11px]">PDF</span>}
                    <span className="text-sub text-[11px]">청크 {d.chunks}개</span>
                  </div>
                  <p className="font-medium truncate">{d.title || "제목 없음"}</p>
                  <p className="text-sub text-[13px] break-words">{d.preview}</p>
                </div>
                <button onClick={() => removeDoc(d.id)} className="shrink-0 text-[13px]" style={{ color: "var(--red)" }}>
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 자료 기록 (감사 로그) */}
      {events.length > 0 && (
        <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-3">
          <h2 className="font-bold text-[17px]">자료 기록</h2>
          <p className="text-sub text-[13px] -mt-1">등록·제거 이력. 지운 자료도 기록은 남아요.</p>
          <div className="flex flex-col gap-2">
            {events.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-[13px]">
                <span
                  className="chip !py-0.5 !px-2 !text-[11px] !cursor-default"
                  style={
                    e.action === "created"
                      ? { background: "var(--blue-weak)", color: "var(--blue)", borderColor: "transparent" }
                      : { background: "var(--red-weak)", color: "var(--red)", borderColor: "transparent" }
                  }
                >
                  {e.action === "created" ? "등록" : "제거"}
                </span>
                <span className="truncate flex-1">{e.title || "제목 없음"}</span>
                <span className="text-sub shrink-0 text-[11px]">
                  {e.kind === "style" ? "말투" : "문제"}
                  {e.source === "pdf" ? "·PDF" : ""} · 청크 {e.chunks}
                </span>
                <span className="text-sub shrink-0 text-[11px]">
                  {new Date(e.created_at).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      </div>

      {/* 우측(PC) / 하단(모바일): 자가 테스트 */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[17px]">내 튜터 직접 테스트</h2>
          <span className="chip !cursor-default">미리보기</span>
        </div>
        <p className="text-sub text-[13px] -mt-1">
          등록한 자료·말투로 어떻게 답하는지 바로 확인하세요.
        </p>
        {savedProfile ? (
          <ChatPanel teacherId={uid} teacherName={name || "나"} compact />
        ) : (
          <p className="text-sub text-[14px] py-6 text-center">프로필을 먼저 저장하면 테스트할 수 있어요.</p>
        )}
      </section>

      <Link href="/ask" className="rise d4 btn btn-ghost py-4 text-center">
        학생 화면으로 보기 →
      </Link>
      </div>
      </div>
    </div>
  );
}
