"use client";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ChatPanel, { type Msg } from "@/components/ChatPanel";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = { id: string; name: string; subject: string | null; enrolled?: boolean; docs?: number; convs?: number };
type Course = { id: string; title: string };
type Conv = { id: string; title: string | null; teacher_id: string; teacher_name: string | null; messages: number };
// 현재 채팅 대상. convId/msgs 있으면 이전 대화 이어가기.
type Chat = { teacherId: string; teacherName: string; convId?: string; msgs?: Msg[] };

export default function AskPage() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null); // null = 로딩
  const [chat, setChat] = useState<Chat | null>(null);
  const [nonce, setNonce] = useState(0); // "새 대화"로 같은 강사 채팅 리마운트
  // 선택된 강사의 강좌 (teacherId 키로 보관 — 렌더에서 현재 강사 것만 사용)
  const [courseData, setCourseData] = useState<{ teacherId: string; courses: Course[] } | null>(null);
  const [courseId, setCourseId] = useState(""); // "" = 전체
  const [err, setErr] = useState("");

  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [role, setRole] = useState<"student" | "teacher" | null>(null);
  const [convs, setConvs] = useState<Conv[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // 강사 목록 — 세션 확정 후 로드 (로그인 학생은 초대된 비공개 강사 포함)
  useEffect(() => {
    if (!sessionReady) return;
    // 멀티테넌트: /ask?academy=<slug> 로 학원 한정 (미지정 시 전체)
    const params = new URLSearchParams(window.location.search);
    const academy = params.get("academy");
    const preselect = params.get("teacher"); // 초대 링크 경유 시 자동 선택
    fetch(`/api/teachers${academy ? `?academy=${encodeURIComponent(academy)}` : ""}`, {
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => {
        const list: Teacher[] = d.teachers ?? [];
        setTeachers(list);
        if (preselect) {
          const t = list.find((x) => x.id === preselect);
          if (t) setChat({ teacherId: t.id, teacherName: t.name });
        }
      })
      .catch(() => {
        setErr("선생님 목록을 불러오지 못했어요. 새로고침해 주세요.");
        setTeachers([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, session?.access_token]);

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

  // 강사 선택 시 그 강사의 강좌 목록 로드
  useEffect(() => {
    const tid = chat?.teacherId;
    if (!tid) return;
    fetch(`/api/courses?teacher=${tid}`)
      .then((r) => r.json())
      .then((d) => setCourseData({ teacherId: tid, courses: d.courses ?? [] }))
      .catch(() => setCourseData({ teacherId: tid, courses: [] }));
  }, [chat?.teacherId]);

  const courses = courseData && courseData.teacherId === chat?.teacherId ? courseData.courses : [];

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
              <p className="text-sub text-[14px] py-2 lg:p-3">아직 선생님이 없어요.</p>
            )}

            {/* PC 세로 리스트 */}
            <div className="hidden lg:flex flex-col gap-1">
              {teachers?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setChat({ teacherId: t.id, teacherName: t.name });
                    setCourseId("");
                  }}
                  className={`t-item ${chat?.teacherId === t.id && !chat?.convId ? "t-item-on" : ""}`}
                >
                  <span className="avatar">{avatarEmoji(t.name)}</span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold truncate">
                      {t.name}
                      {t.enrolled && (
                        <span className="ml-1.5 text-[11px] font-bold text-blue align-middle">내 선생님</span>
                      )}
                    </span>
                    <span className="block text-[13px] text-sub truncate">
                      {t.subject ?? ""}
                      {/* 신뢰 메타 — 근거 데이터량이 곧 품질 신호 (숨고·김과외 프로필 패턴) */}
                      {(t.docs ?? 0) > 0 && (
                        <span className={t.subject ? "ml-1" : ""}>
                          {t.subject ? "· " : ""}자료 {t.docs}
                          {(t.convs ?? 0) > 0 ? ` · 답변 ${t.convs}` : ""}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {/* 모바일 가로 칩 */}
            <div className="flex lg:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {teachers?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setChat({ teacherId: t.id, teacherName: t.name });
                    setCourseId("");
                  }}
                  className={`chip shrink-0 ${chat?.teacherId === t.id && !chat?.convId ? "chip-on" : ""}`}
                >
                  {t.name}
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
            key={`${chat.convId ?? chat.teacherId}-${nonce}`}
            className="animate-pop card p-4 lg:p-6 lg:min-h-[62vh] flex flex-col"
          >
            <div className="flex items-center justify-between gap-2 -mb-2">
              {/* 강좌 필터 — 공용 자료는 어떤 강좌를 골라도 포함 */}
              {courses.length > 0 ? (
                <div className="flex gap-1.5 overflow-x-auto">
                  <button
                    onClick={() => setCourseId("")}
                    className={`chip !py-1 !px-2.5 !text-[12px] shrink-0 ${courseId === "" ? "chip-on" : ""}`}
                  >
                    전체
                  </button>
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCourseId(c.id)}
                      className={`chip !py-1 !px-2.5 !text-[12px] shrink-0 ${courseId === c.id ? "chip-on" : ""}`}
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              <button
                onClick={() => {
                  setChat({ teacherId: chat.teacherId, teacherName: chat.teacherName });
                  setNonce((n) => n + 1);
                }}
                className="text-sub text-[12px] shrink-0"
              >
                + 새 대화
              </button>
            </div>
            <ChatPanel
              teacherId={chat.teacherId}
              teacherName={chat.teacherName}
              token={session?.access_token}
              courseId={courseId || null}
              initialConversationId={chat.convId ?? null}
              initialMsgs={chat.msgs}
            />
          </div>
        ) : (
          (teachers?.length ?? 0) > 0 && (
            <div className="rise d2 card p-10 lg:min-h-[62vh] grid place-items-center text-center">
              <div>
                <p className="text-[16px] font-bold mb-1">선생님을 골라 주세요</p>
                <p className="text-sub text-[14px]">목록에서 선생님을 고르면 바로 질문할 수 있어요.</p>
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
