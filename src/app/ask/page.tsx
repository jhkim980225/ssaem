"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ChatPanel, { type Msg } from "@/components/ChatPanel";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = { id: string; name: string; subject: string | null };
type Conv = { id: string; title: string | null; teacher_id: string; teacher_name: string | null; messages: number };
// 현재 채팅 대상. convId/msgs 있으면 이전 대화 이어가기.
type Chat = { teacherId: string; teacherName: string; convId?: string; msgs?: Msg[] };

export default function AskPage() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null); // null = 로딩
  const [chat, setChat] = useState<Chat | null>(null);
  const [err, setErr] = useState("");

  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<"student" | "teacher" | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);

  useEffect(() => {
    // 멀티테넌트: /ask?academy=<slug> 로 학원 한정 (미지정 시 전체)
    const academy = new URLSearchParams(window.location.search).get("academy");
    fetch(`/api/teachers${academy ? `?academy=${encodeURIComponent(academy)}` : ""}`)
      .then((r) => r.json())
      .then((d) => setTeachers(d.teachers ?? []))
      .catch(() => {
        setErr("선생님 목록을 불러오지 못했어요");
        setTeachers([]);
      });

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 로그인 시 내 이력 로드 (강사 계정이면 숨김 — /teacher/history 사용)
  // 로그아웃 시 리셋은 없음: 렌더가 session 유무로 가드하므로 stale 값이 안 보임
  useEffect(() => {
    if (!session) return;
    fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        setRole(d.role ?? null);
        setConvs(d.role === "student" ? d.conversations ?? [] : []);
      })
      .catch(() => setConvs([]));
  }, [session]);

  async function openConv(c: Conv) {
    if (!session) return;
    const r = await fetch(`/api/conversations?id=${c.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const d = await r.json();
    if (!r.ok) return;
    type Row = { role: "user" | "assistant"; content: string };
    const msgs: Msg[] = ((d.messages ?? []) as Row[]).map((m) => ({
      role: m.role === "user" ? "user" : "tutor",
      text: m.content,
    }));
    setChat({
      teacherId: c.teacher_id,
      teacherName: c.teacher_name ?? "선생님",
      convId: c.id,
      msgs,
    });
  }

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sub text-[13px]">
            ← 홈
          </Link>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">질문하기</h1>
          <p className="text-sub text-[14px]">선생님을 고르고 궁금한 걸 물어보세요.</p>
        </div>
        <StudentAuth session={session} role={role} />
      </div>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      <div className="lg:grid lg:grid-cols-[280px_1fr] lg:gap-5 lg:items-start flex flex-col gap-4">
        {/* PC: 좌측 리스트 / 모바일: 가로 칩 스크롤 */}
        <div className="rise d1 flex flex-col gap-3">
          <div className="lg-card lg:p-3">
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
                  onClick={() => setChat({ teacherId: t.id, teacherName: t.name })}
                  className={`t-item ${chat?.teacherId === t.id && !chat?.convId ? "t-item-on" : ""}`}
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
                  onClick={() => setChat({ teacherId: t.id, teacherName: t.name })}
                  className={`chip shrink-0 ${chat?.teacherId === t.id && !chat?.convId ? "chip-on" : ""}`}
                >
                  {avatarEmoji(t.name)} {t.name}
                  {t.subject ? ` · ${t.subject}` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* 학생 이력 (로그인 시) */}
          {session && role === "student" && convs.length > 0 && (
            <div className="lg-card lg:p-3">
              <p className="text-sub text-[12px] font-bold px-1 pb-1">내 질문 이력</p>
              <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
                {convs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConv(c)}
                    className={`t-item shrink-0 lg:shrink !py-2 ${chat?.convId === c.id ? "t-item-on" : ""}`}
                  >
                    <span className="min-w-0 text-left">
                      <span className="block text-[13px] font-bold truncate max-w-[180px] lg:max-w-none">
                        {c.title ?? "(제목 없음)"}
                      </span>
                      <span className="block text-[12px] text-sub truncate">
                        {c.teacher_name ?? "선생님"} · {c.messages}개
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 채팅 영역 */}
        {chat ? (
          <div
            key={chat.convId ?? chat.teacherId}
            className="animate-pop card p-4 lg:p-6 lg:min-h-[62vh] flex flex-col"
          >
            <ChatPanel
              teacherId={chat.teacherId}
              teacherName={chat.teacherName}
              token={session?.access_token}
              initialConversationId={chat.convId ?? null}
              initialMsgs={chat.msgs}
            />
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

// 학생 로그인/가입. 로그인 없이도 질문 가능 — 로그인하면 이력이 계정에 저장됨.
function StudentAuth({ session, role }: { session: Session | null; role: string | null }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");

  if (session) {
    return (
      <div className="text-right shrink-0">
        <p className="text-[13px] font-bold">
          {role === "teacher" ? "강사 계정" : session.user.email}
        </p>
        <button className="text-sub text-[12px]" onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="chip shrink-0" onClick={() => setOpen(true)}>
        학생 로그인
      </button>
    );
  }

  async function submit() {
    setMsg("");
    if (mode === "signup") {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "student", name, email, password: pw }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg(d.error || "가입 실패");
        return;
      }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setMsg(error.message);
    else setOpen(false);
  }

  return (
    <div className="card p-3 flex flex-col gap-2 w-[220px] shrink-0 animate-pop">
      <p className="text-[13px] font-bold">학생 {mode === "login" ? "로그인" : "가입"}</p>
      {mode === "signup" && (
        <input className="field !py-2 text-[13px]" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
      )}
      <input className="field !py-2 text-[13px]" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="field !py-2 text-[13px]" type="password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button className="btn btn-primary !py-2 text-[13px]" onClick={submit}>
        {mode === "login" ? "로그인" : "가입하기"}
      </button>
      <button
        className="text-sub text-[12px]"
        onClick={() => setMode(mode === "login" ? "signup" : "login")}
      >
        {mode === "login" ? "계정이 없나요? 가입" : "이미 있나요? 로그인"}
      </button>
      <button className="text-sub text-[12px]" onClick={() => setOpen(false)}>
        닫기
      </button>
      {msg && <p className="text-[12px] text-blue">{msg}</p>}
    </div>
  );
}
