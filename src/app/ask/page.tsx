"use client";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ChatPanel, { type Msg } from "@/components/ChatPanel";
import { avatarEmoji } from "@/lib/avatar";

type Teacher = {
  id: string;
  name: string;
  subject: string | null;
  enrolled?: boolean;
  docs?: number;
  convs?: number;
};
type Course = { id: string; title: string };
type Conv = { id: string; title: string | null; teacher_id: string; teacher_name: string | null; messages: number };
// 현재 채팅 대상. convId/msgs 있으면 이전 대화 이어가기, ask 있으면 진입 즉시 질문.
type Chat = { teacherId: string; teacherName: string; convId?: string; msgs?: Msg[]; ask?: string };
type Popular = {
  questions: { text: string; count: number }[];
  byTeacher: { id: string; name: string; count: number; pct: number }[];
};

const TIPS = [
  ["구체적으로 물어보기", "\"3번 문제 2번 선택지가 왜 틀렸는지\"처럼 물으면 더 정확해요."],
  ["강좌를 고르면", "그 강좌 자료에서만 답을 찾아요. 헷갈리는 범위를 좁힐 수 있어요."],
  ["출처를 확인하기", "답변 아래 출처를 열면 어느 자료를 근거로 했는지 볼 수 있어요."],
] as const;

export default function AskPage() {
  const [teachers, setTeachers] = useState<Teacher[] | null>(null); // null = 로딩
  const [chat, setChat] = useState<Chat | null>(null);
  const [nonce, setNonce] = useState(0); // "새 대화"로 같은 강사 채팅 리마운트
  const [query, setQuery] = useState(""); // 선생님 검색
  // 선택된 강사의 강좌 (teacherId 키로 보관 — 렌더에서 현재 강사 것만 사용)
  const [courseData, setCourseData] = useState<{ teacherId: string; courses: Course[] } | null>(null);
  const [courseId, setCourseId] = useState(""); // "" = 전체
  const [err, setErr] = useState("");
  const [popular, setPopular] = useState<Popular | null>(null);

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

  // 요즘 많이 묻는 질문 · 강사별 비중 (선택 강사 있으면 그 강사 기준)
  useEffect(() => {
    const t = chat?.teacherId;
    fetch(`/api/popular${t ? `?teacher=${t}` : ""}`)
      .then((r) => r.json())
      .then((d) => setPopular({ questions: d.questions ?? [], byTeacher: d.byTeacher ?? [] }))
      .catch(() => setPopular({ questions: [], byTeacher: [] }));
  }, [chat?.teacherId]);

  // 로그인 시 내 이력 로드 (강사 계정이면 숨김 — /teacher/history 사용)
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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !teachers) return teachers;
    return teachers.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.subject ?? "").toLowerCase().includes(q)
    );
  }, [teachers, query]);

  const totals = useMemo(() => {
    const list = teachers ?? [];
    return {
      teachers: list.length,
      docs: list.reduce((s, t) => s + (t.docs ?? 0), 0),
      convs: list.reduce((s, t) => s + (t.convs ?? 0), 0),
      mine: list.filter((t) => t.enrolled).length,
    };
  }, [teachers]);

  function pick(t: Teacher, ask?: string) {
    setChat({ teacherId: t.id, teacherName: t.name, ask });
    setCourseId("");
    setNonce((n) => n + 1);
  }

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
    setChat({ teacherId: c.teacher_id, teacherName: c.teacher_name ?? "선생님", convId: c.id, msgs });
  }

  return (
    <main className="flex-1 w-full max-w-[1600px] mx-auto px-5 lg:px-8 py-5 lg:py-7">
      <div className="grid gap-4 lg:gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px] items-start">
        {/* ── 좌측 레일: 검색 · 선생님 · 내 이력 ───────────────── */}
        {/* min-w-0: 그리드 자식 기본 min-width:auto 때문에 내부 가로 스크롤이 페이지를 밀어냄 */}
        <aside className="rise flex flex-col gap-3 min-w-0 lg:sticky lg:top-[76px]">
          <button
            onClick={() => {
              // 대화 중이면 새 대화, 아니면 첫 선생님으로 바로 시작
              if (chat) setChat({ teacherId: chat.teacherId, teacherName: chat.teacherName });
              else if (teachers?.length) setChat({ teacherId: teachers[0].id, teacherName: teachers[0].name });
              setNonce((n) => n + 1);
            }}
            disabled={!teachers?.length}
            className="btn btn-primary py-3 text-[14px]"
          >
            {chat ? "새 대화 시작하기" : "바로 질문 시작하기"}
          </button>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="선생님·과목 검색"
            className="field !py-2.5 !text-[14px]"
          />

          <div className="lg-card lg:p-3">
            <p className="hidden lg:block text-sub text-[12px] font-bold px-1 pb-1.5">선생님</p>

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

            {shown?.length === 0 && (
              <p className="text-sub text-[14px] py-2 lg:p-3">
                {query ? "검색 결과가 없어요." : "아직 선생님이 없어요."}
              </p>
            )}

            {/* PC 세로 리스트 — 자료 수를 우측에 (카테고리 트리 패턴) */}
            <div className="hidden lg:flex flex-col gap-0.5 max-h-[52vh] overflow-y-auto">
              {shown?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className={`t-item !py-2 !gap-2.5 ${chat?.teacherId === t.id && !chat?.convId ? "t-item-on" : ""}`}
                >
                  <span className="avatar !w-8 !h-8 !text-[13px]">{avatarEmoji(t.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold truncate">
                      {t.name}
                      {t.enrolled && (
                        <span className="ml-1.5 text-[11px] font-bold text-blue align-middle">내 선생님</span>
                      )}
                    </span>
                    {t.subject && <span className="block text-[12px] text-sub truncate">{t.subject}</span>}
                  </span>
                  <span className="text-[12px] text-sub tabular-nums shrink-0">{t.docs ?? 0}</span>
                </button>
              ))}
            </div>

            {/* 모바일 가로 칩 */}
            <div className="flex lg:hidden gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {shown?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className={`chip shrink-0 ${chat?.teacherId === t.id && !chat?.convId ? "chip-on" : ""}`}
                >
                  {t.name}
                  {t.subject ? ` · ${t.subject}` : ""}
                </button>
              ))}
            </div>
          </div>

          {/* 내 질문 이력 (로그인 학생) */}
          {session && role === "student" && convs.length > 0 && (
            <div className="lg-card lg:p-3">
              <p className="text-sub text-[12px] font-bold px-1 pb-1">내 질문 이력</p>
              <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-y-auto lg:max-h-[28vh] pb-1 lg:pb-0">
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

          {/* 좌측 하단 안내 카드 */}
          <div className="hidden lg:block card p-4" style={{ background: "var(--blue-weak)", borderColor: "transparent" }}>
            <p className="text-[13px] font-extrabold text-blue">근거 있는 답만 드려요</p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
              인터넷이 아니라 선생님이 올린 자료에서만 찾아요. 답변 아래 출처로 직접 확인할 수 있어요.
            </p>
          </div>
        </aside>

        {/* ── 중앙: 히어로 + 인기 질문 / 채팅 ───────────────── */}
        <section className="flex flex-col gap-4 min-w-0">
          {err && (
            <p className="text-[13px]" style={{ color: "var(--red)" }}>
              {err}
            </p>
          )}

          {chat ? (
            <div
              key={`${chat.convId ?? chat.teacherId}-${nonce}`}
              className="animate-pop card p-4 lg:p-6 lg:min-h-[68vh] flex flex-col"
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
                autoAsk={chat.ask}
              />
            </div>
          ) : (
            <>
              {/* 히어로 */}
              <div
                className="rise card p-6 lg:p-7 flex flex-col xl:flex-row xl:items-center gap-5 xl:gap-6"
                style={{ background: "var(--blue-weak)", borderColor: "transparent" }}
              >
                <div className="flex-1 min-w-0">
                  <span className="chip !py-1 !px-2.5 !text-[12px] !cursor-default !bg-[var(--surface)]">
                    우리 학원 자료 기반
                  </span>
                  <h1 className="mt-3 text-[21px] lg:text-[26px] font-extrabold leading-[1.35] tracking-tight text-balance">
                    선생님이 올린 자료로 정확한 답을 받으세요
                  </h1>
                  <p className="mt-2.5 text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
                    과목 선생님을 고르면 그 선생님 자료에서만 답을 찾아요. 로그인하면 질문 이력이 저장돼요.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      onClick={() => teachers?.[0] && pick(teachers[0])}
                      disabled={!teachers?.length}
                      className="btn btn-primary px-5 py-3 text-[14px]"
                    >
                      바로 질문하기
                    </button>
                    <StudentAuth session={session} role={role} />
                  </div>
                </div>

                {/* 정적 대화 미리보기 — 일러스트 대신 제품 자체 */}
                <div className="shrink-0 w-full xl:w-[264px] card p-4 flex flex-col gap-2">
                  <div className="self-end max-w-[88%] px-3.5 py-2 text-[13px] leading-relaxed bg-blue text-white rounded-[16px] rounded-br-[5px]">
                    감가상각 정액법 계산 어떻게 해요?
                  </div>
                  <div className="self-start max-w-[92%] px-3.5 py-2 text-[13px] leading-relaxed rounded-[16px] rounded-bl-[5px] border border-line bg-[var(--fill-2)]">
                    (취득원가 − 잔존가치) ÷ 내용연수예요. 선생님 자료 2장의 예제로 같이 볼게요.
                  </div>
                  <p className="text-[11px] text-sub pl-1">근거: 선생님 자료 2건 인용</p>
                </div>
              </div>

              {/* 요즘 많이 묻는 질문 — 클릭 시 그 선생님에게 바로 질문 */}
              <div className="rise d2 card p-5 lg:p-6">
                <div className="flex items-baseline justify-between mb-1">
                  <h2 className="font-extrabold text-[16px]">요즘 많이 묻는 질문</h2>
                  <span className="text-sub text-[12px]">눌러서 바로 물어보기</span>
                </div>
                <p className="text-sub text-[13px] mb-4">다른 학생들이 최근에 물어본 주제예요.</p>

                {popular === null && (
                  <div className="flex flex-col gap-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="skel h-14 !rounded-[14px]" />
                    ))}
                  </div>
                )}

                {popular?.questions.length === 0 && (
                  <p className="text-sub text-[14px] py-6 text-center">
                    아직 쌓인 질문이 없어요. 첫 질문을 남겨보세요.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  {popular?.questions.map((qq, i) => (
                    <button
                      key={qq.text}
                      onClick={() => {
                        // 질문이 가장 많은 선생님 우선, 없으면 목록 첫 번째
                        const top = popular?.byTeacher[0]?.id;
                        const t = teachers?.find((x) => x.id === top) ?? teachers?.[0];
                        if (t) pick(t, qq.text);
                      }}
                      className="group flex items-center gap-3 rounded-[14px] border border-line p-3 text-left transition-colors hover:border-[var(--border-strong)]"
                      style={{ background: "var(--fill-2)" }}
                    >
                      <span className="grid place-items-center w-7 h-7 rounded-full text-[13px] font-extrabold shrink-0 bg-blue text-white">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-bold truncate">{qq.text}</span>
                        {qq.count > 1 && (
                          <span className="block text-[12px] text-sub">비슷한 질문 {qq.count}건</span>
                        )}
                      </span>
                      <span className="text-sub text-[16px] shrink-0 transition-transform group-hover:translate-x-0.5">
                        ›
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── 우측 레일: 현황 · 비중 · 팁 ───────────────── */}
        <aside className="flex flex-col gap-4 min-w-0 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-[76px]">
          <div className="rise d1 card p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-extrabold text-[15px]">
                {session && role === "student" ? "나의 학습 현황" : "우리 학원 현황"}
              </h2>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {(session && role === "student"
                ? ([
                    ["내 대화", convs.length],
                    ["주고받은 글", convs.reduce((s, c) => s + c.messages, 0)],
                    ["내 선생님", totals.mine],
                  ] as const)
                : ([
                    ["선생님", totals.teachers],
                    ["등록 자료", totals.docs],
                    ["누적 답변", totals.convs],
                  ] as const)
              ).map(([label, n]) => (
                <div key={label} className="rounded-[14px] py-3" style={{ background: "var(--fill-2)" }}>
                  <p className="text-[20px] font-extrabold tabular-nums">{n.toLocaleString()}</p>
                  <p className="text-[11px] text-sub mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 질문이 몰리는 과목 */}
          {(popular?.byTeacher.length ?? 0) > 0 && (
            <div className="rise d2 card p-5">
              <h2 className="font-extrabold text-[15px] mb-4">질문이 많은 선생님</h2>
              <div className="flex flex-col gap-3">
                {popular!.byTeacher.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      const t = teachers?.find((x) => x.id === b.id);
                      if (t) pick(t);
                    }}
                    className="text-left group"
                  >
                    <div className="flex items-center justify-between text-[13px] mb-1.5">
                      <span className="font-bold truncate group-hover:text-blue transition-colors">{b.name}</span>
                      <span className="text-sub tabular-nums shrink-0 ml-2">{b.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--fill)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.max(b.pct, 3)}%`, background: "var(--blue)" }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 이렇게 물어보세요 */}
          <div className="rise d3 card p-5">
            <h2 className="font-extrabold text-[15px] mb-3">이렇게 물어보세요</h2>
            <div className="flex flex-col gap-3">
              {TIPS.map(([t, s]) => (
                <div key={t}>
                  <p className="text-[13px] font-bold text-blue">{t}</p>
                  <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: "var(--sub-2)" }}>
                    {s}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </aside>
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
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-bold truncate max-w-[180px]">
          {role === "teacher" ? "강사 계정" : session.user.email}
        </span>
        <button className="text-sub text-[12px]" onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="btn btn-gray px-5 py-3 text-[14px]" onClick={() => setOpen(true)}>
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
        setMsg(d.error || "가입하지 못했어요");
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
      <button className="text-sub text-[12px]" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? "계정이 없나요? 가입" : "이미 있나요? 로그인"}
      </button>
      {mode === "login" && (
        <a href="/reset" className="text-sub text-[12px] text-center">
          비밀번호를 잊으셨나요?
        </a>
      )}
      <button className="text-sub text-[12px]" onClick={() => setOpen(false)}>
        닫기
      </button>
      {msg && <p className="text-[12px] text-blue">{msg}</p>}
    </div>
  );
}
