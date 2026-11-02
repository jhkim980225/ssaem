"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useGate } from "@/components/RoleGuard";
import ChatPanel, { type Msg } from "@/components/ChatPanel";
import LessonCalendar from "@/components/LessonCalendar";
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
type Lesson = { id: string; title: string; summary: string | null; date: string; course_id: string | null; course: string | null };
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
  // 수업 달력 — 강사가 날짜를 지정해 올린 자료 (teacherId 키로 보관, 강사 등록분과 항상 동기화)
  const [lessonData, setLessonData] = useState<{ teacherId: string; lessons: Lesson[] } | null>(null);
  // 자료 게시판 — 선생님이 올린 내려받기 자료 (teacherId 키로 보관)
  type BoardPost = { id: string; course: string | null; title: string; body: string | null; fileName: string | null; fileUrl: string | null; createdAt: string };
  const [boardData, setBoardData] = useState<{ teacherId: string; posts: BoardPost[] } | null>(null);
  // 과제 제출 — 내 제출본(문서 id 키), 작성 중 초안, 전송 상태
  const [mySubs, setMySubs] = useState<Record<string, { content: string; updatedAt: string }>>({});
  const [hwDraft, setHwDraft] = useState<Record<string, string>>({});
  const [hwBusy, setHwBusy] = useState<string | null>(null);
  const [lessonDate, setLessonDate] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [popular, setPopular] = useState<Popular | null>(null);

  // 질문은 로그인 계정에서만 — 익명 질문은 이력이 안 남고 남용 방어도 IP뿐이라 닫았다
  const { session, gate, role, allowed } = useGate("any", {
    loginMessage: "질문하려면 로그인해 주세요. 대화는 계정에 저장돼요.",
  });
  const [convs, setConvs] = useState<Conv[]>([]);

  // 강사·원장이 "학생 화면 미리보기"(/ask?preview=1)로 들어온 상태.
  // 이 화면은 role이 student가 아니면 학생 전용 영역(선생님 코드·과제 제출·내 현황)을 숨긴다 —
  // 그래서 강사가 그냥 /ask를 열면 "학생에게 어떻게 보이는지"를 볼 수 없었다.
  // URL은 이 페이지의 기존 방식대로 이펙트에서 읽는다(useSearchParams는 Suspense 경계를 요구).
  const [previewParam, setPreviewParam] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL(preview) 값을 상태로 한 번 옮기는 동기화
    setPreviewParam(new URLSearchParams(window.location.search).get("preview") === "1");
  }, []);
  const previewing = previewParam && (role === "teacher" || role === "admin");
  // 학생 배치로 그릴지 — 진짜 학생이거나 미리보기. 기록(대화·제출)은 학생 계정에 묶여 있어 미리보기에선 비어 있다.
  const asStudent = role === "student" || previewing;

  // 강사 목록 — 세션 확정 후 로드 (로그인 학생은 초대된 비공개 강사 포함)
  useEffect(() => {
    if (!allowed || !session) return;
    // 멀티테넌트: /ask?academy=<slug> 로 학원 한정 (미지정 시 전체)
    const params = new URLSearchParams(window.location.search);
    const academy = params.get("academy");
    const preselect = params.get("teacher"); // 초대 링크 경유 시 자동 선택
    fetch(`/api/teachers${academy ? `?academy=${encodeURIComponent(academy)}` : ""}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
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
  }, [allowed, session]);

  // 요즘 많이 묻는 질문 · 강사별 비중 (선택 강사 있으면 그 강사 기준)
  useEffect(() => {
    const t = chat?.teacherId;
    if (!allowed || !session) return;
    fetch(`/api/popular${t ? `?teacher=${t}` : ""}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setPopular({ questions: d.questions ?? [], byTeacher: d.byTeacher ?? [] }))
      .catch(() => setPopular({ questions: [], byTeacher: [] }));
  }, [chat?.teacherId, allowed, session]);

  // 학생 이력만 로드 (강사·원장은 /teacher/history, /admin 사용)
  useEffect(() => {
    if (!session || role !== "student") return;
    fetch("/api/conversations", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setConvs(d.conversations ?? []))
      .catch(() => setConvs([]));
  }, [session, role]);

  // 강사 선택 시 그 강사의 강좌 목록 로드
  useEffect(() => {
    const tid = chat?.teacherId;
    if (!allowed || !tid || !session) return;
    fetch(`/api/courses?teacher=${tid}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setCourseData({ teacherId: tid, courses: d.courses ?? [] }))
      .catch(() => setCourseData({ teacherId: tid, courses: [] }));
  }, [chat?.teacherId, allowed, session]);

  // 달력 기준 선생님: 대화 중이면 그 선생님, 아니면(랜딩) 연결된 첫 선생님 —
  // 대화를 시작해야만 달력이 보이면 학생이 수업 달력 기능을 알 길이 없다
  const calTeacherId = chat?.teacherId ?? teachers?.[0]?.id ?? null;

  // 수업 달력 로드 — 강사가 새로 올리면 다시 선택/새로고침 시 그대로 반영된다
  useEffect(() => {
    if (!allowed || !calTeacherId || !session) return;
    const tid = calTeacherId;
    fetch(`/api/lessons?teacher=${tid}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setLessonData({ teacherId: tid, lessons: d.lessons ?? [] }))
      .catch(() => setLessonData({ teacherId: tid, lessons: [] }));
  }, [calTeacherId, allowed, session]);

  // 자료 게시판 로드 — 달력과 같은 선생님 기준
  useEffect(() => {
    if (!allowed || !calTeacherId || !session) return;
    const tid = calTeacherId;
    fetch(`/api/board?teacher=${tid}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setBoardData({ teacherId: tid, posts: d.posts ?? [] }))
      .catch(() => setBoardData({ teacherId: tid, posts: [] }));
  }, [calTeacherId, allowed, session]);
  const boardPosts = boardData && boardData.teacherId === calTeacherId ? boardData.posts : [];

  // 내 과제 제출본 로드 (로그인 학생만)
  useEffect(() => {
    if (!allowed || !session || role !== "student") return;
    fetch("/api/submissions?mine=1", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, { content: string; updatedAt: string }> = {};
        for (const s of d.submissions ?? []) map[s.documentId] = { content: s.content, updatedAt: s.updatedAt };
        setMySubs(map);
      })
      .catch(() => {});
  }, [allowed, session, role]);

  async function submitHomework(documentId: string) {
    const content = (hwDraft[documentId] ?? mySubs[documentId]?.content ?? "").trim();
    if (!content || !session || hwBusy || previewing) return; // 미리보기에선 실제 제출 금지
    setHwBusy(documentId);
    try {
      const r = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ documentId, content }),
      });
      if (r.ok) setMySubs((m) => ({ ...m, [documentId]: { content, updatedAt: new Date().toISOString() } }));
    } finally {
      setHwBusy(null);
    }
  }

  const courses = courseData && courseData.teacherId === chat?.teacherId ? courseData.courses : [];
  const lessons = lessonData && lessonData.teacherId === calTeacherId ? lessonData.lessons : [];
  // ROOM을 고르면 달력도 그 강좌 수업만
  const roomLessons = courseId ? lessons.filter((l) => l.course_id === courseId) : lessons;
  const lessonMarks = new Set(roomLessons.map((l) => l.date));
  const dayLessons = lessonDate ? roomLessons.filter((l) => l.date === lessonDate) : [];
  const fmtLesson = (s: string) => {
    const [, m, d] = s.split("-");
    return `${+m}월 ${+d}일`;
  };
  /** ROOM 변경 — 날짜 선택은 강좌가 바뀌면 의미가 달라지므로 함께 해제 */
  function pickRoom(id: string) {
    setCourseId(id);
    setLessonDate(null);
  }

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

  // 선생님 코드 입력 — 코드 없이 가입한 학생이 여기서 직접 등록한다 (자동 연결은 없앴다)
  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);

  async function joinByCode() {
    const code = joinCode.trim();
    if (!code || joinBusy || !session || previewing) return; // 미리보기에선 실제 등록 금지
    setJoinBusy(true);
    setJoinMsg(null);
    try {
      const r = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setJoinMsg({ text: d?.error ?? "코드를 확인해 주세요.", err: true });
      // 강사 목록 갱신 + 방금 등록한 선생님으로 바로 이동
      const tr = await fetch("/api/teachers", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const td = await tr.json().catch(() => null);
      const list: Teacher[] = td?.teachers ?? [];
      setTeachers(list);
      setJoinCode("");
      setJoinMsg({ text: "등록됐어요!", err: false });
      const t = list.find((x) => x.id === d.teacherId);
      if (t) pick(t);
    } finally {
      setJoinBusy(false);
    }
  }

  function pick(t: Teacher, ask?: string) {
    setChat({ teacherId: t.id, teacherName: t.name, ask });
    setCourseId("");
    setLessonDate(null);
    setNonce((n) => n + 1);
    // 강사 선택을 히스토리에 쌓는다 — 뒤로가기가 페이지 이탈이 아니라 목록 복귀가 되게
    window.history.pushState({}, "", `/ask?teacher=${t.id}`);
  }

  // 뒤로/앞으로 이동 시 URL의 teacher 파라미터에 맞춰 화면 복원
  useEffect(() => {
    const h = () => {
      const tid = new URLSearchParams(window.location.search).get("teacher");
      if (!tid) return setChat(null);
      const t = teachers?.find((x) => x.id === tid);
      if (t) {
        setChat({ teacherId: t.id, teacherName: t.name });
        setCourseId("");
        setLessonDate(null);
        setNonce((n) => n + 1);
      }
    };
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, [teachers]);

  async function openConv(c: Conv) {
    if (!session) return;
    const r = await fetch(`/api/conversations?id=${c.id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const d = await r.json().catch(() => null);
    // 조용히 return하면 클릭이 무반응으로 보인다
    if (!r.ok) return setErr(d?.error ?? "대화를 불러오지 못했어요. 다시 눌러 주세요.");
    setErr("");
    setCourseId(""); // 다른 강사 대화로 넘어갈 때 이전 강사의 강좌 필터가 남지 않게
    setLessonDate(null);
    type Row = { role: "user" | "assistant"; content: string };
    const msgs: Msg[] = ((d?.messages ?? []) as Row[]).map((m) => ({
      role: m.role === "user" ? "user" : "tutor",
      text: m.content,
    }));
    setChat({ teacherId: c.teacher_id, teacherName: c.teacher_name ?? "선생님", convId: c.id, msgs });
  }

  if (gate) return gate;

  // 폰 배치: 좌·우 레일을 display:contents로 풀어 한 줄 세로 스택으로 만들고 order로 시안 순서를 맞춘다
  // (인사 → 선생님 → 달력 → 많이 묻는 질문 → 자료실 → 학습 현황). lg 이상은 3열 그리드 그대로.
  // 폰에서 대화 중이면 대화 화면만 — 나머지 카드는 뒤로 버튼으로 돌아가 본다.
  const H = chat ? " max-lg:hidden" : "";
  const first = teachers?.[0];
  const ROOM_LINE = courseId
    ? `ROOM: ${courses.find((c) => c.id === courseId)?.title ?? "강좌"} — 이 강좌 자료에서만 찾아요`
    : "전체 자료에서 찾아요";

  // 선생님 코드 입력 — 초대코드(s./c.)로 수강 등록. 자동 연결이 없으니 이게 정식 입구.
  // 연결된 선생님이 없으면 빈 화면 바로 아래, 있으면 폰에선 맨 아래(헤더 "코드 입력"으로 이동)
  const joinCard = session && asStudent && (
    <section
      id="join-code"
      className={`card p-5 lg:p-4 flex flex-col gap-3 scroll-mt-20 ${
        teachers?.length === 0 ? "order-3" : "order-9"
      } lg:order-none${H}`}
    >
      <div>
        <h2 className="font-bold text-[18px] lg:text-[15px]">선생님 코드 입력</h2>
        <p className="text-sub text-[14px] lg:text-[13px] mt-1 leading-relaxed">
          수업 시간에 받은 코드나 QR 아래 글자를 넣어 주세요.
        </p>
      </div>
      <label className="flex flex-col gap-2 text-[13px] font-semibold" style={{ color: "var(--sub-2)" }}>
        선생님께 받은 코드
        <input
          className="field !text-[17px] lg:!text-[15px] font-bold tracking-wide"
          placeholder="선생님께 받은 코드"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) joinByCode();
          }}
        />
      </label>
      {joinMsg && (
        <p
          className={`text-[13px] font-semibold ${joinMsg.err ? "" : "text-blue"}`}
          style={joinMsg.err ? { color: "var(--red)" } : undefined}
        >
          {joinMsg.text}
        </p>
      )}
      <button
        onClick={joinByCode}
        disabled={joinBusy || previewing}
        className="btn btn-primary h-[50px] lg:h-11 text-[16px] lg:text-[14px] disabled:opacity-50"
      >
        {joinBusy ? "등록 중…" : "선생님 등록"}
      </button>
    </section>
  );

  return (
    <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 lg:px-8 py-3 lg:py-7">
      {previewing && (
        <div
          className="rise mb-3 lg:mb-4 rounded-[16px] p-4 flex flex-wrap items-center justify-between gap-3"
          style={{ background: "var(--blue-weak)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-blue">학생 화면 미리보기</p>
            <p className="text-sub text-[13px] leading-relaxed">
              학생에게는 이렇게 보여요. 대화 이력·과제 제출은 학생 계정에 저장되는 것이라 여기서는 비어 있고,
              제출·등록 버튼도 눌리지 않아요. 학생은 자기가 등록된 선생님과 ROOM만 봐요.
            </p>
          </div>
          <Link href="/teacher" className="chip !text-[13px] shrink-0">
            미리보기 끝내기
          </Link>
        </div>
      )}
      <div className="flex flex-col gap-3 lg:grid lg:gap-5 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_340px] lg:items-start">
        {/* ── 좌측 레일: 새 대화 · 선생님 · 코드 · ROOM · 달력 · 자료실 · 이력 ───────────────── */}
        {/* min-w-0: 그리드 자식 기본 min-width:auto 때문에 내부 가로 스크롤이 페이지를 밀어냄 */}
        <aside className="contents lg:flex lg:flex-col lg:gap-3 lg:min-w-0 lg:sticky lg:top-[76px]">
          <button
            onClick={() => {
              // 대화 중이면 새 대화, 아니면 첫 선생님으로 바로 시작
              if (chat) setChat({ teacherId: chat.teacherId, teacherName: chat.teacherName });
              else if (teachers?.length) setChat({ teacherId: teachers[0].id, teacherName: teachers[0].name });
              setNonce((n) => n + 1);
            }}
            disabled={!teachers?.length}
            className="hidden lg:block btn btn-primary h-[52px] text-[15px]"
          >
            {chat ? "+ 새 대화 시작하기" : "+ 바로 질문 시작하기"}
          </button>

          <section className={`card p-5 pr-0 lg:p-3 min-w-0 order-2 lg:order-none${H}`}>
            <div className="flex items-center justify-between pr-5 lg:pr-0 mb-3.5 lg:mb-2 lg:hidden">
              <h2 className="font-bold text-[18px]">선생님</h2>
              {session && asStudent && (
                // 해시 링크는 popstate를 일으켜 위 teacher 복원 핸들러를 건드린다 — 스크롤만
                <button
                  onClick={() => document.getElementById("join-code")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="text-[14px] text-sub hover:text-blue transition-colors"
                >
                  코드 입력
                </button>
              )}
            </div>

            {/* 검색 — PC는 항상, 폰은 선생님이 많을 때만 (2~3명에 검색칸은 군더더기) */}
            <div className={`pr-5 lg:pr-0 mb-3 lg:mb-2 ${(teachers?.length ?? 0) > 4 ? "" : "max-lg:hidden"}`}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="선생님·과목 검색"
                className="field !py-2.5 !text-[14px]"
              />
            </div>

            {teachers === null && (
              <>
                <div className="hidden lg:flex flex-col gap-2 p-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-3 p-2">
                      <div className="skel w-9 h-9 !rounded-full" />
                      <div className="flex-1 flex flex-col gap-1.5">
                        <div className="skel h-3.5 w-2/5" />
                        <div className="skel h-3 w-3/5" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex lg:hidden gap-2.5 overflow-hidden">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skel w-[150px] h-[124px] !rounded-[12px] shrink-0" />
                  ))}
                </div>
              </>
            )}

            {shown?.length === 0 &&
              (query ? (
                <p className="text-sub text-[14px] py-2 pr-5 lg:p-3">검색 결과가 없어요.</p>
              ) : (
                <div className="flex flex-col items-center text-center gap-2.5 py-5 pr-5 lg:p-3">
                  <span
                    className="grid place-items-center w-16 h-16 lg:w-12 lg:h-12 rounded-[14px] text-blue"
                    style={{ background: "var(--blue-weak)" }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="9" cy="8" r="4" />
                      <path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6" />
                    </svg>
                  </span>
                  <p className="font-bold text-[20px] lg:text-[15px] mt-1">아직 연결된 선생님이 없어요</p>
                  <p className="text-sub text-[15px] lg:text-[13px] leading-relaxed">
                    선생님께 받은 코드를 넣으면
                    <br />
                    그 선생님 자료로 답을 받을 수 있어요.
                  </p>
                </div>
              ))}

            {/* PC 세로 리스트 */}
            <div className="hidden lg:flex flex-col gap-0.5 max-h-[52vh] overflow-y-auto">
              {shown?.map((t) => (
                <button
                  key={t.id}
                  onClick={() => pick(t)}
                  className={`t-item !p-2.5 !gap-2.5 !rounded-[10px] ${chat?.teacherId === t.id && !chat?.convId ? "t-item-on" : ""}`}
                >
                  <span className="avatar !w-9 !h-9 !text-[14px]">{avatarEmoji(t.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold truncate">
                      {t.name}
                      {t.enrolled && (
                        <span className="ml-1.5 text-[11px] font-bold text-blue align-middle">내 선생님</span>
                      )}
                    </span>
                    <span className="block text-[12px] text-sub truncate">
                      {[t.subject, `자료 ${t.docs ?? 0}`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {/* 폰 가로 스크롤 카드 — 달력·자료실 기준 선생님을 강조 */}
            <div className="flex lg:hidden gap-2.5 overflow-x-auto pr-5 pb-1">
              {shown?.map((t) => {
                const on = calTeacherId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => pick(t)}
                    className={`shrink-0 w-[150px] rounded-[12px] border p-4 flex flex-col items-start gap-2.5 text-left ${
                      on ? "border-transparent" : "border-line"
                    }`}
                    style={{ background: on ? "var(--blue-weak)" : "var(--fill-2)" }}
                  >
                    <span className="avatar !w-10 !h-10 !text-[16px]">{avatarEmoji(t.name)}</span>
                    <span className="w-full">
                      <span className="block text-[16px] font-bold truncate">{t.name}</span>
                      <span className="block text-[13px] truncate mt-0.5" style={{ color: "var(--sub-2)" }}>
                        {[t.subject, `자료 ${t.docs ?? 0}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {joinCard}

          {/* 강좌 ROOM — PC 레일. 폰은 대화 화면 상단 칩 줄 */}
          {chat && courses.length > 0 && (
            <section className="hidden lg:block card p-4">
              <p className="text-sub text-[13px] font-bold mb-2">강좌 ROOM</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => pickRoom("")}
                  className={`chip !py-1.5 !px-3 !text-[13px] ${courseId === "" ? "chip-on" : ""}`}
                >
                  전체 자료
                </button>
                {courses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pickRoom(c.id)}
                    className={`chip !py-1.5 !px-3 !text-[13px] max-w-full truncate ${courseId === c.id ? "chip-on" : ""}`}
                  >
                    {c.title}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* 수업 달력 — 선생님이 날짜를 지정해 올린 수업 자료를 날짜별로 본다 (강사 등록분과 동기화).
              자료 0건이어도 달력은 보여준다 — 통째로 숨기면 학생이 기능이 있는 줄도 모른다 */}
          {calTeacherId && (
            <section className={`card p-5 lg:p-4 order-4 lg:order-none${H}`}>
              <LessonCalendar title="수업 달력" marked={lessonMarks} selected={lessonDate} onSelect={setLessonDate} />
              {lessons.length === 0 && (
                <p className="text-sub text-[13px] mt-2">
                  아직 날짜가 지정된 수업 자료가 없어요. 선생님이 올리면 달력에 점으로 표시돼요.
                </p>
              )}
              {lessonDate && (
                <div className="flex flex-col gap-2.5 mt-4">
                  <p className="text-[14px] font-bold" style={{ color: "var(--sub-2)" }}>
                    {fmtLesson(lessonDate)} 수업
                  </p>
                  {dayLessons.length === 0 && (
                    <p className="text-sub text-[13px]">이 날은 이 강좌 수업 자료가 없어요.</p>
                  )}
                  {dayLessons.map((l) => (
                    <div key={l.id} className="flex flex-col gap-2.5">
                      {/* 카드 전체 → 수업 상세 페이지. 좁은 레일에선 요약이 잘려 읽기 힘들다 */}
                      <Link
                        href={`/lesson/${l.id}`}
                        className="block rounded-[12px] border border-line p-4 hover:border-[var(--border-strong)] transition-colors"
                        style={{ background: "var(--fill-2)" }}
                      >
                        <span className="block text-[16px] lg:text-[15px] font-bold leading-snug break-words">{l.title}</span>
                        {/* AI 요약 — 강사 메모를 학생용으로 정리한 것 */}
                        {l.summary && (
                          <span className="block text-[14px] lg:text-[13px] leading-relaxed mt-1.5 line-clamp-3" style={{ color: "var(--sub-2)" }}>
                            {l.summary}
                          </span>
                        )}
                        <span className="block text-[13px] text-sub mt-2.5">{l.course ?? "공용"} · 전체 보기 →</span>
                      </Link>
                      {/* 과제 제출 — 로그인 학생만. 제출하면 선생님 ROOM 화면에 바로 보인다 */}
                      {session && asStudent && (
                        <details className="group">
                          <summary className="btn btn-ghost h-12 flex items-center justify-center gap-2 text-[15px] list-none [&::-webkit-details-marker]:hidden">
                            {mySubs[l.id] ? (
                              <>
                                과제 제출함
                                <span className="rounded-[8px] px-2 py-0.5 text-[12px] bg-surface">
                                  {new Date(mySubs[l.id].updatedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} · 수정 가능
                                </span>
                              </>
                            ) : (
                              "과제 제출하기"
                            )}
                          </summary>
                          <div className="flex flex-col gap-2 mt-3">
                            <label className="flex flex-col gap-2 text-[13px] font-semibold" style={{ color: "var(--sub-2)" }}>
                              푼 내용 · 답
                              <textarea
                                className="field !text-[15px] !rounded-[12px] leading-relaxed resize-none font-normal"
                                rows={5}
                                placeholder="푼 내용·답을 적어 주세요"
                                value={hwDraft[l.id] ?? mySubs[l.id]?.content ?? ""}
                                onChange={(e) => setHwDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                              />
                            </label>
                            <button
                              onClick={() => submitHomework(l.id)}
                              disabled={previewing || hwBusy === l.id || !(hwDraft[l.id] ?? mySubs[l.id]?.content ?? "").trim()}
                              className="btn btn-primary w-full h-12 text-[15px] disabled:opacity-50"
                            >
                              {hwBusy === l.id ? "제출 중…" : mySubs[l.id] ? "다시 제출" : "제출"}
                            </button>
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 자료실 — 선생님이 게시판에 올린 내려받기 자료 */}
          {calTeacherId && boardPosts.length > 0 && (
            <section className={`card p-5 lg:p-4 order-6 lg:order-none${H}`}>
              <h2 className="font-bold text-[18px] lg:text-[15px] mb-1">자료실</h2>
              <div className="flex flex-col">
                {boardPosts.slice(0, 6).map((p) => (
                  <div key={p.id} className="flex items-start gap-3 py-3 border-t border-line first:border-t-0">
                    <span
                      className="grid place-items-center w-10 h-10 lg:w-9 lg:h-9 rounded-[8px] shrink-0 text-blue"
                      style={{ background: "var(--blue-weak)" }}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        {p.fileUrl ? (
                          <>
                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                            <path d="M14 3v5h5" />
                          </>
                        ) : (
                          <path d="M4 5h16v11H8l-4 4z" />
                        )}
                      </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] lg:text-[14px] font-bold leading-snug break-words">{p.title}</p>
                      {p.body && <p className="text-[13px] text-sub leading-relaxed mt-0.5 break-words line-clamp-3">{p.body}</p>}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {p.fileUrl && (
                          <a
                            href={p.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="chip !py-0.5 !px-2 !text-[12px] max-w-full truncate"
                          >
                            📎 {p.fileName}
                          </a>
                        )}
                        <span className="text-[13px] text-sub">
                          {p.course ?? "공용"} ·{" "}
                          {new Date(p.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 내 질문 이력 (로그인 학생) */}
          {session && asStudent && convs.length > 0 && (
            <section className={`card p-5 lg:p-4 min-w-0 order-8 lg:order-none${H}`}>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-[18px] lg:text-[13px] lg:text-sub">내 질문 이력</h2>
                <Link href="/my/history" className="text-sub text-[14px] lg:text-[12px] hover:text-blue transition-colors">
                  전체 보기
                </Link>
              </div>
              <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-y-auto lg:max-h-[28vh] pb-1 lg:pb-0">
                {convs.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openConv(c)}
                    className={`t-item shrink-0 lg:shrink !py-2 !px-2.5 !rounded-[10px] ${chat?.convId === c.id ? "t-item-on" : ""}`}
                    style={chat?.convId === c.id ? undefined : { background: "var(--fill-2)" }}
                  >
                    <span className="min-w-0 text-left">
                      <span className="block text-[14px] font-semibold truncate max-w-[180px] lg:max-w-none">
                        {c.title ?? "(제목 없음)"}
                      </span>
                      <span className="block text-[12px] text-sub truncate">
                        {c.teacher_name ?? "선생님"} · {c.messages}개
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </aside>

        {/* ── 중앙: 인사 + 질문 진입 / 대화 ───────────────── */}
        <section className="order-1 lg:order-none flex flex-col gap-3 lg:gap-4 min-w-0">
          {err && (
            <p className="text-[13px]" style={{ color: "var(--red)" }}>
              {err}
            </p>
          )}

          {chat ? (
            <div
              key={`${chat.convId ?? chat.teacherId}-${nonce}`}
              className="animate-pop card p-4 pt-2 lg:p-0 lg:min-h-[68vh] flex flex-col"
            >
              {/* 대화 헤더 — 폰은 뒤로·새 대화 아이콘, PC는 글자 링크 */}
              <div className="flex items-center gap-1 -mx-2 lg:mx-0 pb-2 lg:px-6 lg:py-4 border-b border-line">
                <button
                  onClick={() => {
                    // 폰 대화 화면 → 홈 카드로. URL의 teacher를 지워 새로고침해도 홈으로 온다
                    setChat(null);
                    const u = new URL(window.location.href);
                    u.searchParams.delete("teacher");
                    window.history.replaceState({}, "", u);
                  }}
                  aria-label="뒤로"
                  className="lg:hidden grid place-items-center w-11 h-11 shrink-0"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1 lg:flex lg:items-baseline lg:gap-2">
                  <p className="text-[16px] lg:text-[17px] font-bold truncate shrink-0">{chat.teacherName} 선생님</p>
                  {/* 현재 ROOM 표시 — 선택은 강좌 ROOM 칩에서 (공용 자료는 어떤 강좌를 골라도 포함) */}
                  {courses.length > 0 && <p className="text-[12px] lg:text-[13px] text-sub truncate">{ROOM_LINE}</p>}
                </div>
                <button
                  onClick={() => {
                    setChat({ teacherId: chat.teacherId, teacherName: chat.teacherName });
                    setNonce((n) => n + 1);
                  }}
                  aria-label="새 대화"
                  className="grid place-items-center w-11 h-11 shrink-0 lg:w-auto lg:h-auto lg:text-blue lg:text-[14px] lg:font-bold"
                >
                  <svg className="lg:hidden" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span className="hidden lg:inline">+ 새 대화</span>
                </button>
              </div>

              {/* 폰 강좌 ROOM 칩 줄 */}
              {courses.length > 0 && (
                <div className="lg:hidden flex gap-2 overflow-x-auto -mx-4 px-4 py-3 border-b border-line">
                  <button
                    onClick={() => pickRoom("")}
                    className={`chip shrink-0 !py-1.5 !px-3 !text-[13px] ${courseId === "" ? "chip-on" : ""}`}
                  >
                    전체 자료
                  </button>
                  {courses.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => pickRoom(c.id)}
                      className={`chip shrink-0 !py-1.5 !px-3 !text-[13px] ${courseId === c.id ? "chip-on" : ""}`}
                    >
                      {c.title}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 flex flex-col pt-2 lg:px-6 lg:pb-5">
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
            </div>
          ) : (
            /* 인사 카드 — 질문 입력 진입 + 예시 질문 */
            <div className="rise card px-5 pt-6 pb-5 lg:p-8">
              <div className="flex items-center justify-between gap-3 mb-1">
                <p className="text-[14px] font-semibold text-sub">안녕하세요</p>
                <StudentAuth session={session} role={role} />
              </div>
              <h1 className="text-[23px] lg:text-[28px] font-bold leading-[1.4] tracking-tight mb-4">오늘은 뭐가 궁금해요?</h1>
              <button
                onClick={() => first && pick(first)}
                disabled={!first}
                className="w-full h-[50px] lg:h-14 rounded-[12px] border border-line flex items-center gap-2.5 px-4 text-left text-[16px] text-sub transition-colors hover:border-[var(--border-strong)] disabled:opacity-60"
                style={{ background: "var(--fill-2)" }}
              >
                <svg className="text-blue shrink-0" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                </svg>
                <span className="truncate">
                  {first ? `${first.name} 선생님께 질문하기` : teachers === null ? "선생님 불러오는 중…" : "선생님을 먼저 연결해 주세요"}
                </span>
              </button>
              {first && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {["핵심 개념 쉽게 설명해줘", "연습 문제 하나 내줘"].map((s) => (
                    <button
                      key={s}
                      onClick={() => pick(first, s)}
                      className="btn btn-ghost !rounded-[8px] h-8 px-3 text-[13px] !font-semibold"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <p className="hidden lg:block mt-6 text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
                과목 선생님을 고르면 그 선생님 자료에서만 답을 찾아요. 질문 이력은 계정에 저장돼요.
              </p>
            </div>
          )}
        </section>

        {/* ── 우측 레일: 현황 · 많이 묻는 질문 · 비중 · 팁 ───────────────── */}
        {/* sticky 금지 — 이 레일은 카드가 많아 화면보다 길어서, 붙이면 스크롤을 따라다니며 본문을 가린다 */}
        <aside className="contents lg:flex lg:flex-col lg:gap-3 lg:min-w-0 lg:col-span-2 xl:col-span-1">
          <section className={`lg-card lg:p-5 order-7 lg:order-none${H}`}>
            <h2 className="hidden lg:block font-bold text-[16px] mb-3">
              {session && asStudent ? "나의 학습 현황" : "우리 학원 현황"}
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {(session && asStudent
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
                <div
                  key={label}
                  className="card !rounded-[14px] p-4 flex flex-col lg:flex-col-reverse gap-1.5 lg:gap-0.5 lg:px-1 lg:py-3 lg:text-center lg:!rounded-[10px] lg:!border-transparent lg:!shadow-none lg:!bg-[var(--fill-2)]"
                >
                  <p className="text-[13px] lg:text-[12px] text-sub">{label}</p>
                  <p className="text-[22px] lg:text-[20px] font-bold tabular-nums">{n.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 요즘 많이 묻는 질문 — 클릭 시 그 선생님에게 바로 질문 */}
          <section className={`card p-5 order-5 lg:order-none${H}`}>
            <h2 className="font-bold text-[18px] lg:text-[16px]">요즘 많이 묻는 질문</h2>
            <p className="text-sub text-[13px] mt-1 mb-2">눌러서 바로 물어보기</p>

            {popular === null && (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skel h-10 !rounded-[10px]" />
                ))}
              </div>
            )}

            {popular?.questions.length === 0 && (
              <p className="text-sub text-[14px] py-5 text-center">아직 쌓인 질문이 없어요. 첫 질문을 남겨보세요.</p>
            )}

            <div className="flex flex-col">
              {popular?.questions.map((qq, i) => (
                <button
                  key={qq.text}
                  onClick={() => {
                    // 질문이 가장 많은 선생님 우선, 없으면 목록 첫 번째
                    const top = popular?.byTeacher[0]?.id;
                    const t = teachers?.find((x) => x.id === top) ?? teachers?.[0];
                    if (t) pick(t, qq.text);
                  }}
                  className="group flex items-center gap-3.5 py-3 text-left border-t border-line first:border-t-0"
                >
                  <b className="w-[18px] shrink-0 text-blue text-[16px] tabular-nums">{i + 1}</b>
                  <span className="min-w-0 flex-1 text-[15px] lg:text-[14px] truncate group-hover:text-blue transition-colors">
                    {qq.text}
                  </span>
                  {qq.count > 1 && <span className="text-[13px] text-sub shrink-0 tabular-nums">{qq.count}건</span>}
                </button>
              ))}
            </div>
          </section>

          {/* 질문이 몰리는 과목 */}
          {(popular?.byTeacher.length ?? 0) > 0 && (
            <section className={`card p-5 order-10 lg:order-none${H}`}>
              <h2 className="font-bold text-[18px] lg:text-[16px] mb-4">질문이 많은 선생님</h2>
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
                    <div className="flex items-center justify-between text-[14px] mb-1.5">
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
            </section>
          )}

          {/* 이렇게 물어보세요 */}
          <section className={`card p-5 order-11 lg:order-none${H}`}>
            <h2 className="font-bold text-[18px] lg:text-[16px] mb-3">이렇게 물어보세요</h2>
            <div className="flex flex-col gap-3">
              {TIPS.map(([t, s]) => (
                <div key={t}>
                  <p className="text-[14px] font-bold text-blue">{t}</p>
                  <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: "var(--sub-2)" }}>
                    {s}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 안내 카드 */}
          <div className="hidden lg:block rounded-[16px] p-5" style={{ background: "var(--blue-weak)" }}>
            <p className="text-[15px] font-bold text-blue">근거 있는 답만 드려요</p>
            <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}>
              인터넷이 아니라 선생님이 올린 자료에서만 찾아요. 답변 아래 출처로 직접 확인할 수 있어요.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}

// 계정 표시 + 로그아웃. 로그인/가입은 /login으로 일원화.
const ROLE_LABEL: Record<string, string> = { teacher: "강사 계정", admin: "학원장 계정" };

function StudentAuth({ session, role }: { session: Session | null; role: string | null | undefined }) {
  if (session) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <span className="font-bold truncate max-w-[180px]">
          {(role && ROLE_LABEL[role]) ?? session.user.email?.replace(/@ssaem\.kr$/, "")}
        </span>
        <button className="text-sub text-[12px]" onClick={() => supabase.auth.signOut()}>
          로그아웃
        </button>
      </div>
    );
  }
  return (
    <Link href="/login?role=student" className="btn btn-gray px-5 py-3 text-[14px]">
      학생 로그인
    </Link>
  );
}
