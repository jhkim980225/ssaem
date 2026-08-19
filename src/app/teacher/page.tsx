"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import type { Session } from "@supabase/supabase-js";
import ChatPanel from "@/components/ChatPanel";
import InviteBox from "@/components/InviteBox";
import LessonCalendar from "@/components/LessonCalendar";
import { TEACHER_REFRESH } from "@/components/TeacherSidebar";

type Doc = {
  id: string;
  kind: string;
  title: string | null;
  source: string;
  preview: string;
  raw: string;
  chunks: number;
  created_at: string;
  course_id: string | null;
  course: string | null;
  lesson_date: string | null; // YYYY-MM-DD (ROOM 달력)
};

type Course = { id: string; title: string; documents: number };

type Usage = {
  plan: "free" | "pro";
  documents: { used: number; limit: number | null };
  questionsToday: { used: number; limit: number | null };
};

type Quiz = {
  id: string;
  question: string;
  choices: string[];
  answer: number;
  explanation: string | null;
  document_id: string | null;
};

type Review = { id: string; rating: number; comment: string | null; updatedAt: string };

type Assessment = {
  id: string;
  title: string;
  courseId: string | null;
  questions: number;
  createdAt: string;
};

const PAGE = 20; // 자료 목록 한 번에 보여줄 개수

type DocEvent = {
  id: string;
  action: "created" | "updated" | "deleted";
  title: string | null;
  kind: string | null;
  source: string | null;
  chunks: number;
  created_at: string;
};

export default function TeacherPage() {
  // allowNoProfile: 강사 가입 직후(프로필 저장 전)엔 role이 없다 — 설정에서 프로필을 만들어야 하므로 통과
  const { session, gate } = useGate("teacher", {
    allowNoProfile: true,
    loginRender: (
      <main className="flex-1 w-full mx-auto px-5 py-8 max-w-lg">
        <AuthForm />
      </main>
    ),
  });
  if (gate) return gate;

  return (
    <main className="flex-1 w-full mx-auto px-5 lg:px-8 py-8 max-w-lg lg:max-w-[1300px]">
      {/* useSearchParams(강좌 ROOM 선택)를 쓰므로 Suspense 필수 */}
      <Suspense fallback={null}>
        <Dashboard session={session!} />
      </Suspense>
    </main>
  );
}

// 로그인 폼은 /login으로 일원화 — 인증 UI가 두 벌로 갈라지지 않게
function AuthForm() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login?role=teacher");
  }, [router]);
  return (
    <div className="grid place-items-center py-20">
      <div className="skel w-12 h-12 !rounded-full" />
    </div>
  );
}

function Dashboard({ session }: { session: Session }) {
  const token = session.access_token;
  const uid = session.user.id;
  const router = useRouter();

  // 사이드바에서 고른 강좌 ROOM. null=전체, "none"=공용, 그 외=강좌 id
  const room = useSearchParams().get("room");

  const [name, setName] = useState("");
  // null = /api/profile 응답 전. false로 두면 이미 저장된 강사에게도 "먼저 저장하세요"가 잠깐 뜬다
  const [savedProfile, setSavedProfile] = useState<boolean | null>(null);
  const [invite, setInvite] = useState<{ url: string; qrSvg: string } | null>(null);

  const [content, setContent] = useState("");
  const [docs, setDocs] = useState<Doc[] | null>(null); // null = 아직 로딩 중 (자료 0건과 구분)
  const [docsErr, setDocsErr] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  // 자료별 출제 문항. LLM이 이상하게 만든 문제를 강사가 직접 걷어낼 수 있어야 한다.
  const [quizzes, setQuizzes] = useState<Record<string, Quiz[]>>({});
  const [events, setEvents] = useState<DocEvent[]>([]);
  const [msg, setMsg] = useState("");
  const [msgErr, setMsgErr] = useState(false); // 실패 메시지를 성공 톤(파랑)으로 안 띄우기 위해
  const say = useCallback((text: string, err = false) => {
    setMsg(text);
    setMsgErr(err);
  }, []);

  // 수강평 (학생이 남긴 평가 — 작성자는 서버가 익명 처리해 보낸다)
  const [reviews, setReviews] = useState<{ count: number; avg: number | null; reviews: Review[] } | null>(null);

  // 평가 세트 (엑셀/CSV 업로드 시험)
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [asTitle, setAsTitle] = useState("");
  const [asCourse, setAsCourse] = useState("");
  const [asBusy, setAsBusy] = useState(false);

  const [courses, setCourses] = useState<Course[]>([]);
  const [courseSel, setCourseSel] = useState(""); // 업로드 대상 강좌. "" = 공용
  // 목록 전용 상태. 자료가 수십 건이면 전부 그리는 것만으로 화면이 수천 px가 된다.
  const [docQuery, setDocQuery] = useState("");
  const [docLimit, setDocLimit] = useState(PAGE);

  /** 강좌·자료가 바뀌었다 — 사이드바(강좌 수)와 이 화면이 같이 다시 불러온다 */
  const ping = useCallback(() => window.dispatchEvent(new Event(TEACHER_REFRESH)), []);

  const loadDocs = useCallback(async () => {
    try {
      const [dr, er, cr, qr, ur] = await Promise.all([
        fetch("/api/documents", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/documents/events", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/courses", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/quiz/generate", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/usage", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!dr.ok) throw new Error();
      const d = await dr.json();
      setDocs(d.documents ?? []);
      setDocsErr("");
      const e = await er.json();
      if (er.ok) setEvents(e.events ?? []);
      const c = await cr.json();
      if (cr.ok) setCourses(c.courses ?? []);
      // 자료 단위로 묶어둔다 — 문제는 자료에서 나오므로 자료 카드에서 관리하는 게 자연스럽다
      const qd = await qr.json();
      if (qr.ok) {
        const by: Record<string, Quiz[]> = {};
        for (const q of (qd.questions ?? []) as Quiz[]) {
          if (!q.document_id) continue;
          (by[q.document_id] ??= []).push(q);
        }
        setQuizzes(by);
      }
      if (ur.ok) setUsage(await ur.json());
    } catch {
      // docs는 그대로 둔다 — 실패를 "자료 없음"으로 오해하게 만들지 않기 위해
      setDocsErr("자료 목록을 불러오지 못했어요 — 새로고침해 주세요.");
    }
  }, [token]);

  const loadReviews = useCallback(async () => {
    try {
      const r = await fetch("/api/reviews", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return; // 테이블 미생성 등 — 대시보드 나머지는 그대로 쓴다
      setReviews(await r.json());
    } catch {
      /* 부가 기능이라 조용히 */
    }
  }, [token]);

  const loadAssessments = useCallback(async () => {
    try {
      const r = await fetch("/api/assessments", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) return; // 테이블 미생성 등 — 대시보드 나머지는 그대로 쓴다
      const d = await r.json();
      setAssessments(d.assessments ?? []);
    } catch {
      /* 목록 로드 실패는 조용히 — 평가는 부가 기능 */
    }
  }, [token]);

  async function uploadAssessment(file: File) {
    if (asBusy) return;
    const title = asTitle.trim();
    if (!title) return say("평가 이름을 입력해 주세요.", true);
    setAsBusy(true);
    say("평가 문항을 읽는 중…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title);
      if (asCourse) fd.append("courseId", asCourse);
      const r = await fetch("/api/assessments", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return say(d?.error || "평가를 만들지 못했어요.", true);
      say(`평가를 만들었어요 — ${d.created}문항${d.skipped ? ` (형식이 안 맞는 ${d.skipped}줄은 건너뜀)` : ""}`);
      setAsTitle("");
      loadAssessments();
    } catch {
      say("평가를 만들지 못했어요 — 네트워크를 확인해 주세요.", true);
    } finally {
      setAsBusy(false);
    }
  }

  /** 평가 결과 CSV 내려받기 — 구글시트에 그대로 붙여넣을 수 있다 */
  async function downloadResults(id: string, title: string) {
    try {
      const r = await fetch(`/api/assessments/${id}/results?csv=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return say("결과를 내려받지 못했어요.", true);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title}_결과.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      say("결과를 내려받지 못했어요 — 네트워크를 확인해 주세요.", true);
    }
  }

  async function removeAssessment(id: string) {
    if (!confirm("이 평가를 삭제할까요? 학생 응시 기록도 함께 지워져요.")) return;
    const r = await fetch(`/api/assessments?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (r?.ok) loadAssessments();
    else say("평가를 삭제하지 못했어요.", true);
  }

  /** 업로드 양식(.xlsx) 즉석 생성 — 정적 파일을 따로 관리하지 않는다 */
  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const rows = [
      ["문제", "보기1", "보기2", "보기3", "보기4", "정답", "해설"],
      ["감가상각 정액법 계산식은?", "(취득원가-잔존가치)÷내용연수", "취득원가÷내용연수", "장부가액×상각률", "취득원가×상각률", "1", "정액법은 매기 같은 금액을 상각해요."],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "평가문항");
    XLSX.writeFile(wb, "평가양식.xlsx");
  }

  // 강좌 이름 변경 — ROOM 헤더에서 바로 고친다
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState("");
  // 수업 달력 (강좌 ROOM 전용). 날짜를 고르면 그 날 수업 자료만 + 업로드도 그 날짜로.
  const [lessonDate, setLessonDate] = useState<string | null>(null);
  // ROOM 초대 (강좌별 코드 — 이 코드로 가입하면 그 ROOM에 바로 등록)
  const [roomInvite, setRoomInvite] = useState<{ courseId: string; url: string; qrSvg: string } | null>(null);

  async function renameCourse(id: string) {
    const title = renameText.trim();
    if (!title) return;
    const r = await fetch("/api/courses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, title }),
    });
    if (r.ok) {
      setRenaming(false);
      ping(); // 사이드바·본문 강좌 목록 갱신
    } else say("강좌 이름을 바꾸지 못했어요 — 다시 시도해 주세요.", true);
  }

  async function removeCourse(id: string) {
    if (!confirm("강좌를 삭제할까요? 담겨 있던 자료는 공용으로 바뀌어요.")) return;
    const r = await fetch(`/api/courses?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      ping();
      router.push("/teacher"); // 지운 ROOM에 머물 수 없다
    } else say("강좌를 삭제하지 못했어요 — 다시 시도해 주세요.", true);
  }

  useEffect(() => {
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setName(d.profile.name ?? "");
          setSavedProfile(true);
        } else setSavedProfile(false);
      })
      .catch(() => setSavedProfile(false));
    fetch("/api/invite", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => d.url && setInvite({ url: d.url, qrSvg: d.qrSvg }))
      .catch(() => {});
  }, [token]);

  // 프로필을 저장해야 role=teacher가 되고 자료 API가 열린다.
  // 저장 전에 부르면 403이라 "불러오지 못했어요" 배너가 첫 화면부터 뜬다.
  useEffect(() => {
    if (savedProfile !== true) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async 함수라 setState는 await 이후, 동기 캐스케이드 아님
    loadDocs();
    loadAssessments();
    loadReviews();
  }, [savedProfile, loadDocs, loadAssessments, loadReviews]);

  // 사이드바에서 강좌를 만들거나 지우면 여기 목록도 따라와야 한다
  useEffect(() => {
    if (savedProfile !== true) return;
    const h = () => loadDocs();
    window.addEventListener(TEACHER_REFRESH, h);
    return () => window.removeEventListener(TEACHER_REFRESH, h);
  }, [savedProfile, loadDocs]);

  // ROOM에 들어가면 업로드 대상도 그 강좌로, 목록 상태는 초기화
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL(room) 변화에 파생 상태를 맞추는 동기화
    setCourseSel(room && room !== "none" ? room : "");
    setDocQuery("");
    setDocLimit(PAGE);
    setRenaming(false);
    setLessonDate(null);
  }, [room]);

  const roomCourse = room && room !== "none" ? courses.find((c) => c.id === room) ?? null : null;
  const inRoom = room !== null;

  // ROOM 초대 코드 로드 — 강좌마다 코드가 다르다
  const roomCourseId = roomCourse?.id ?? null;
  useEffect(() => {
    if (!roomCourseId || savedProfile !== true) return;
    fetch(`/api/invite?course=${roomCourseId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => d.url && setRoomInvite({ courseId: roomCourseId, url: d.url, qrSvg: d.qrSvg }))
      .catch(() => {});
  }, [roomCourseId, savedProfile, token]);

  const lessonMarks = new Set(
    (docs ?? []).filter((d) => d.course_id === room && d.lesson_date).map((d) => d.lesson_date!)
  );
  const fmtLesson = (s: string) => {
    const [, m, d] = s.split("-");
    return `${+m}월 ${+d}일`;
  };

  // 검색·ROOM 필터를 적용한 목록. 원본 docs는 총계(개수·청크 수) 표시에 그대로 쓴다.
  const shownDocs = (docs ?? []).filter((d) => {
    if (room === "none" ? d.course_id !== null : room && d.course_id !== room) return false;
    if (roomCourse && lessonDate && d.lesson_date !== lessonDate) return false;
    const q = docQuery.trim().toLowerCase();
    if (!q) return true;
    return (d.title ?? "").toLowerCase().includes(q) || d.preview.toLowerCase().includes(q);
  });

  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [quizBusy, setQuizBusy] = useState<string | null>(null); // 문제 생성 중인 documentId

  async function saveEdit() {
    if (!editId || !editText.trim()) return;
    say("수정 중… 자료를 다시 정리하고 있어요.");
    const r = await fetch("/api/documents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id: editId, content: editText }),
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "수정 실패", true);
    else {
      say("수정했어요");
      setEditId(null);
      ping();
    }
  }

  // 자료 하나로 객관식 문제 생성. LLM 호출이라 수 초 걸림 — 버튼에 진행 표시.
  async function makeQuiz(documentId: string) {
    setQuizBusy(documentId);
    say("자료를 문제로 정리하고 있어요…");
    try {
      const r = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ documentId, count: 5 }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok) {
        say(`문제 ${d.created}개를 만들었어요`);
        loadDocs(); // 방금 만든 문항이 카드에 바로 보이게
      } else say(d?.error || "문제를 만들지 못했어요", true);
    } catch {
      // 네트워크 throw 시 quizBusy가 남아 그 자료의 '문제 만들기' 버튼이 영구 비활성되던 것 방지
      say("문제를 만들지 못했어요 — 네트워크를 확인해 주세요.", true);
    } finally {
      setQuizBusy(null);
    }
  }

  async function removeQuiz(quizId: string, documentId: string) {
    if (!confirm("이 문제를 삭제할까요? 되돌릴 수 없어요.")) return;
    const r = await fetch(`/api/quiz/generate?id=${quizId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return say("문제를 삭제하지 못했어요 — 다시 시도해 주세요.", true);
    setQuizzes((prev) => ({
      ...prev,
      [documentId]: (prev[documentId] ?? []).filter((q) => q.id !== quizId),
    }));
  }

  async function removeDoc(id: string) {
    if (!confirm("이 자료를 삭제할까요? 되돌릴 수 없어요.")) return;
    const r = await fetch(`/api/documents?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) ping();
    else say("삭제하지 못했어요 — 다시 시도해 주세요.", true);
  }

  async function uploadPdf(file: File) {
    say("PDF 읽는 중…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "problem");
    if (courseSel) fd.append("courseId", courseSel);
    if (roomCourse && lessonDate) fd.append("lessonDate", lessonDate);
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "업로드 실패", true);
    else {
      say(`PDF를 등록했어요 (${d.chars}자)`);
      ping();
    }
  }

  async function addDoc() {
    if (!content.trim()) return;
    say("");
    const r = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        kind: "problem",
        content,
        courseId: courseSel || null,
        lessonDate: roomCourse ? lessonDate : null,
      }),
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "실패", true);
    else {
      setContent("");
      say("자료를 추가했어요");
      ping();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rise flex justify-between items-end gap-3 flex-wrap">
        <div>
          {inRoom && (
            <Link href="/teacher" className="text-sub text-[13px]">
              ← 전체 자료
            </Link>
          )}
          {roomCourse && renaming ? (
            <div className="flex gap-2 items-center mt-1">
              <input
                autoFocus
                aria-label="강좌 이름"
                className="field !py-2.5 !text-[16px] font-bold"
                value={renameText}
                maxLength={100}
                onChange={(e) => setRenameText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) renameCourse(roomCourse.id);
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
              <button onClick={() => renameCourse(roomCourse.id)} className="btn btn-primary px-4 py-2.5 !text-[13px] shrink-0">
                저장
              </button>
              <button onClick={() => setRenaming(false)} className="btn btn-gray px-4 py-2.5 !text-[13px] shrink-0">
                취소
              </button>
            </div>
          ) : (
            <h1 className="text-[24px] lg:text-[28px] font-extrabold">
              {room === "none" ? "공용 자료" : roomCourse ? roomCourse.title : inRoom ? "강좌" : "강사 대시보드"}
            </h1>
          )}
          {inRoom && (
            <p className="text-sub text-[13px] mt-0.5">
              {room === "none"
                ? "어느 강좌에도 속하지 않는 자료 — 모든 강좌 검색에서 함께 쓰여요."
                : "이 강좌 ROOM의 자료만 보여요. 여기서 올리면 이 강좌에 담겨요."}
            </p>
          )}
        </div>
        {roomCourse && !renaming && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setRenameText(roomCourse.title);
                setRenaming(true);
              }}
              className="chip !text-[13px]"
            >
              이름 바꾸기
            </button>
            <button onClick={() => removeCourse(roomCourse.id)} className="chip !text-[13px]" style={{ color: "var(--red)" }}>
              강좌 삭제
            </button>
          </div>
        )}
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_420px] lg:gap-5 lg:items-start flex flex-col gap-4">
      <div className="flex flex-col gap-4 min-w-0">
      {/* 프로필이 없으면 자료 API가 전부 403 — 먼저 설정으로 보낸다 */}
      {savedProfile === false && (
        <section className="rise d1 card p-5 lg:p-6 flex flex-col gap-3">
          <h2 className="font-bold text-[17px]">먼저 프로필을 저장해 주세요</h2>
          <p className="text-sub text-[14px] leading-relaxed">
            이름과 과목을 저장해야 자료 등록·학생 초대를 쓸 수 있어요.
          </p>
          <Link href="/teacher/settings" className="btn btn-primary py-3 px-6 self-start">
            프로필 설정하러 가기
          </Link>
        </section>
      )}

      {/* 학생 초대 — 전체 대시보드에서만. ROOM은 자료 관리에 집중 */}
      {!inRoom && savedProfile && invite && (
        <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
          <h2 className="font-bold text-[17px]">학생 초대</h2>
          <p className="text-sub text-[13px] -mt-1">
            QR을 보여주거나 링크를 공유하세요. 학생이 접속하면 가입과 동시에 내 기본반에 등록돼요.
          </p>
          <InviteBox
            url={invite.url}
            qrSvg={invite.qrSvg}
            hint="학생이 회원가입 때 초대코드 칸에 넣어요"
          />
        </section>
      )}

      {/* ROOM 초대 — 이 코드로 가입한 학생은 이 강좌에 바로 등록된다. 학생은 여러 ROOM에 등록 가능 */}
      {roomCourse && savedProfile && (
        <details className="rise d1 card p-5 lg:p-6">
          <summary className="font-bold text-[17px] cursor-pointer select-none flex items-center justify-between gap-2">
            <span>이 ROOM으로 학생 초대</span>
            <span className="text-sub text-[13px] font-normal shrink-0">펼치기</span>
          </summary>
          <p className="text-sub text-[13px] mt-2">
            이 링크·코드로 가입한 학생은 <b>{roomCourse.title}</b>에 바로 등록돼요. 다른 ROOM 코드로 또
            등록하면 여러 ROOM에 함께 들어가요.
          </p>
          <div className="mt-3">
            {roomInvite?.courseId === roomCourse.id ? (
              <InviteBox
                url={roomInvite.url}
                qrSvg={roomInvite.qrSvg}
                hint="학생이 회원가입 때 초대코드 칸에 넣어요"
              />
            ) : (
              <div className="skel h-24 !rounded-[16px]" />
            )}
          </div>
        </details>
      )}

      {/* 수업 달력 — 강좌 ROOM 전용. 날짜별로 그 날 수업 자료를 묶는다 */}
      {roomCourse && savedProfile && (
        <section className="rise d1 card p-5 lg:p-6 flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-bold text-[17px]">수업 달력</h2>
            {lessonDate && (
              <button onClick={() => setLessonDate(null)} className="chip !text-[12px]">
                {fmtLesson(lessonDate)} 선택 해제 ×
              </button>
            )}
          </div>
          <p className="text-sub text-[13px] -mt-1">
            날짜를 고르면 그 날 수업 자료만 보이고, 새로 올리는 자료도 그 날짜 수업에 담겨요.
          </p>
          <LessonCalendar marked={lessonMarks} selected={lessonDate} onSelect={setLessonDate} />
        </section>
      )}

      {/* 자료 */}
      {savedProfile && (
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-[17px]">
            학습 자료
            {roomCourse && lessonDate && (
              <span className="text-blue text-[13px] font-bold"> · {fmtLesson(lessonDate)} 수업</span>
            )}
          </h2>
          {/* 예전엔 한도 초과를 "버튼 눌러 실패해야" 알 수 있었다 */}
          {usage && (
            <span className="text-[13px] text-sub">
              {usage.documents.limit === null ? (
                <>자료 {usage.documents.used}건 · 무제한</>
              ) : (
                <span style={usage.documents.used >= usage.documents.limit ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  자료 {usage.documents.used}/{usage.documents.limit}건
                </span>
              )}
              {" · "}
              {usage.questionsToday.limit === null ? (
                <>오늘 질문 {usage.questionsToday.used}건</>
              ) : (
                <span style={usage.questionsToday.used >= usage.questionsToday.limit ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  오늘 질문 {usage.questionsToday.used}/{usage.questionsToday.limit}건
                </span>
              )}
            </span>
          )}
        </div>
        {usage?.documents.limit !== null &&
          usage &&
          usage.documents.used >= usage.documents.limit! && (
            <p className="text-[13px] rounded-[12px] px-3 py-2.5" style={{ background: "var(--blue-weak)", color: "var(--blue)" }}>
              무료 플랜 자료 한도({usage.documents.limit}건)를 다 썼어요. 더 올리려면 원장님께 문의해 주세요.
            </p>
          )}
        {/* ROOM 안에선 업로드 대상이 그 강좌로 고정 — 고를 필요가 없다 */}
        {!inRoom && courses.length > 0 && (
          <select
            className="field !py-2.5"
            value={courseSel}
            onChange={(e) => setCourseSel(e.target.value)}
          >
            <option value="">공용 (모든 강좌에서 함께 써요)</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <textarea
          className="field min-h-28 resize-none"
          placeholder="문제와 풀이를 붙여넣으세요"
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
        {msg && (
          <p className={`text-[13px] ${msgErr ? "" : "text-blue"}`} style={msgErr ? { color: "var(--red)" } : undefined}>
            {msg}
          </p>
        )}

        {docsErr && <p className="text-[13px]" style={{ color: "var(--red)" }}>{docsErr}</p>}

        {!docsErr && docs === null && (
          <div className="flex flex-col gap-2 mt-1">
            <div className="skel h-3.5 w-40" />
            <div className="skel h-16 !rounded-[14px]" />
            <div className="skel h-16 !rounded-[14px]" />
          </div>
        )}

        {docs && shownDocs.length === 0 && !docQuery && (
          <p className="text-sub text-[13px] mt-1">
            {roomCourse && lessonDate
              ? `${fmtLesson(lessonDate)} 수업 자료가 아직 없어요. 지금 올리면 이 날짜에 담겨요.`
              : inRoom
                ? "이 ROOM엔 아직 자료가 없어요. 위에서 올리면 여기에 담겨요."
                : "아직 등록된 자료가 없어요. 문제·풀이를 붙여넣거나 PDF를 올려보세요."}
          </p>
        )}

        {docs && shownDocs.length + (docQuery ? 1 : 0) > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-sub text-[13px]">
              {inRoom ? (
                <>이 ROOM 자료 {shownDocs.length}개 · 청크 {shownDocs.reduce((s, d) => s + d.chunks, 0)}개</>
              ) : (
                <>등록된 자료 {docs.length}개 · 청크 {docs.reduce((s, d) => s + d.chunks, 0)}개</>
              )}
            </p>

            {/* 자료가 수십 건이면 전부 그리는 것만으로 화면이 수천 px가 되고, 원하는 자료를 못 찾는다 */}
            {(docQuery || shownDocs.length > 5) && (
              <input
                className="field !py-2.5"
                placeholder="자료 검색 (제목·내용)"
                value={docQuery}
                onChange={(e) => {
                  setDocQuery(e.target.value);
                  setDocLimit(PAGE);
                }}
              />
            )}

            {shownDocs.length === 0 && (
              <p className="text-sub text-[13px] py-3 text-center">조건에 맞는 자료가 없어요.</p>
            )}

            {shownDocs.slice(0, docLimit).map((d) =>
              editId === d.id ? (
                <div key={d.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
                  {/* 배경은 .field(--surface)에 맡긴다 — Tailwind dark:는 prefers-color-scheme,
                      이 앱 테마는 data-theme이라 흰 배경을 강제하면 다크에서 흰 글자+흰 배경이 됨 */}
                  <textarea
                    className="field min-h-32 resize-none"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="btn btn-primary py-2 px-5 text-[13px]">저장</button>
                    <button onClick={() => setEditId(null)} className="btn btn-gray py-2 px-5 text-[13px]">취소</button>
                  </div>
                </div>
              ) : (
              <div key={d.id} className="rounded-[14px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
              <div className="flex justify-between gap-2">
                <div className="text-[14px] min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="chip !py-0.5 !px-2 !text-[11px]">
                      {d.kind === "style" ? "말투" : "문제"}
                    </span>
                    {/* ROOM 안에선 어느 강좌인지 자명 — 전체 목록에서만 표시 */}
                    {!inRoom && <span className="chip !py-0.5 !px-2 !text-[11px]">{d.course ?? "공용"}</span>}
                    {d.lesson_date && (
                      <span className="chip !py-0.5 !px-2 !text-[11px]" style={{ color: "var(--blue)" }}>
                        {fmtLesson(d.lesson_date)} 수업
                      </span>
                    )}
                    {d.source === "pdf" && <span className="chip !py-0.5 !px-2 !text-[11px]">PDF</span>}
                    <span className="text-sub text-[11px]">청크 {d.chunks}개</span>
                  </div>
                  <p className="font-medium truncate">{d.title || "제목 없음"}</p>
                  <p className="text-sub text-[13px] break-words">{d.preview}</p>
                </div>
                <div className="shrink-0 flex flex-col gap-2 items-end">
                  {/* 말투 자료는 "AI가 어떻게 답할지" 지시문이라 출제 대상이 아니다 (서버도 400으로 막음) */}
                  {d.kind !== "style" && (
                    <button
                      onClick={() => makeQuiz(d.id)}
                      disabled={quizBusy === d.id}
                      className="text-[13px] text-blue disabled:opacity-50"
                    >
                      {quizBusy === d.id ? "만드는 중…" : "문제 만들기"}
                    </button>
                  )}
                  {d.source === "text" && (
                    <button
                      onClick={() => { setEditId(d.id); setEditText(d.raw); }}
                      className="text-[13px] text-blue"
                    >
                      수정
                    </button>
                  )}
                  <button onClick={() => removeDoc(d.id)} className="text-[13px]" style={{ color: "var(--red)" }}>
                    삭제
                  </button>
                </div>
              </div>

              {/* 출제한 문제 — 예전엔 만들고 나면 확인·삭제할 화면이 없어서
                  LLM이 이상하게 만든 문항을 걷어낼 방법이 없었다 */}
              {(quizzes[d.id]?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="text-[13px] text-sub cursor-pointer select-none">
                    출제한 문제 {quizzes[d.id].length}개
                  </summary>
                  <ol className="mt-2 flex flex-col gap-2">
                    {quizzes[d.id].map((q, qi) => (
                      <li key={q.id} className="rounded-[12px] border border-line p-3" style={{ background: "var(--surface)" }}>
                        <div className="flex justify-between gap-2">
                          <p className="text-[13px] font-medium min-w-0">
                            {qi + 1}. {q.question}
                          </p>
                          <button
                            onClick={() => removeQuiz(q.id, d.id)}
                            className="text-[12px] shrink-0"
                            style={{ color: "var(--red)" }}
                          >
                            삭제
                          </button>
                        </div>
                        <ul className="mt-1.5 flex flex-col gap-0.5">
                          {q.choices.map((c, ci) => (
                            <li
                              key={ci}
                              className="text-[12px]"
                              style={ci === q.answer ? { color: "var(--blue)", fontWeight: 700 } : { color: "var(--sub)" }}
                            >
                              {ci === q.answer ? "✓" : "·"} {c}
                            </li>
                          ))}
                        </ul>
                        {q.explanation && (
                          <p className="text-sub text-[12px] mt-1.5 leading-relaxed">{q.explanation}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              </div>
              )
            )}
            {shownDocs.length > docLimit && (
              <button
                onClick={() => setDocLimit((n) => n + PAGE)}
                className="btn btn-gray py-3 text-[14px] mt-1"
              >
                {shownDocs.length - docLimit}개 더 보기
              </button>
            )}
          </div>
        )}
      </section>
      )}

      {/* 수강평 (학생 → 나) — 전체 대시보드에서만 */}
      {!inRoom && reviews && reviews.count > 0 && (
        <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-[17px]">수강평</h2>
              <p className="text-sub text-[13px]">학생이 남긴 평가예요. 누가 썼는지는 보이지 않아요.</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[22px] font-extrabold tabular-nums text-blue">
                {reviews.avg?.toFixed(1) ?? "-"}
              </p>
              <p className="text-sub text-[12px]">{reviews.count}개</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {reviews.reviews.map((r) => (
              <div key={r.id} className="rounded-[14px] border border-line p-3.5">
                <p className="text-[13px]" style={{ color: "var(--blue)" }}>
                  {"★".repeat(r.rating)}
                  <span style={{ color: "var(--line)" }}>{"★".repeat(5 - r.rating)}</span>
                </p>
                {r.comment && <p className="text-[14px] leading-relaxed mt-1">{r.comment}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 평가 세트 — 전체 대시보드에서만 (강좌 지정은 아래 선택으로) */}
      {!inRoom && savedProfile && (
      <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-[17px]">평가</h2>
            <p className="text-sub text-[13px]">
              엑셀·CSV로 시험 문항을 올리면 학생이 문제풀이 화면에서 응시해요. 1인 1회만 응시할 수 있어요.
            </p>
          </div>
          <button onClick={downloadTemplate} className="chip shrink-0 !text-[13px]">
            양식 받기
          </button>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="field flex-1"
            placeholder="평가 이름 (예: 3월 모의고사)"
            value={asTitle}
            onChange={(e) => setAsTitle(e.target.value)}
            maxLength={80}
          />
          <select className="field sm:w-44" value={asCourse} onChange={(e) => setAsCourse(e.target.value)}>
            <option value="">전체 학생</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <label className={`btn btn-primary py-3 text-center cursor-pointer ${asBusy ? "opacity-60" : ""}`}>
          {asBusy ? "읽는 중…" : "엑셀·CSV 올리기"}
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={asBusy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ""; // 같은 파일 다시 올릴 수 있게
              if (f) uploadAssessment(f);
            }}
          />
        </label>

        {assessments.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            {assessments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-[14px] border border-line p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold truncate">{a.title}</p>
                  <p className="text-sub text-[12px]">
                    {a.questions}문항
                    {a.courseId ? ` · ${courses.find((c) => c.id === a.courseId)?.title ?? "반"}` : " · 전체 학생"}
                  </p>
                </div>
                <button
                  onClick={() => downloadResults(a.id, a.title)}
                  className="chip !text-[12px] shrink-0"
                  title="응시 결과를 CSV로 받아 구글시트에 붙여넣을 수 있어요"
                >
                  결과 CSV
                </button>
                <button
                  onClick={() => removeAssessment(a.id)}
                  className="chip !text-[12px] shrink-0"
                  style={{ color: "var(--red)" }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* 자료 기록 (감사 로그) — 전체 대시보드에서만 */}
      {!inRoom && events.length > 0 && (
        <details className="rise d3 card p-5 lg:p-6">
          <summary className="font-bold text-[17px] cursor-pointer select-none">
            자료 기록 <span className="text-sub text-[13px] font-normal">· {events.length}건</span>
          </summary>
          <p className="text-sub text-[13px] mt-2">등록·제거 이력. 지운 자료도 기록은 남아요.</p>
          <div className="flex flex-col gap-2 mt-3">
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
                  {e.action === "created" ? "등록" : e.action === "updated" ? "수정" : "제거"}
                </span>
                <span className="truncate flex-1">{e.title || "제목 없음"}</span>
                <span className="text-sub shrink-0 text-[11px]">
                  문제{e.source === "pdf" ? "·PDF" : ""} · 청크 {e.chunks}
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
        </details>
      )}

      </div>

      {/* 우측(PC) / 하단(모바일): 자가 테스트 — 이동 메뉴는 사이드바로 옮겼다 */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[17px]">내 튜터 직접 테스트</h2>
          <span className="chip !cursor-default">미리보기</span>
        </div>
        <p className="text-sub text-[13px] -mt-1">
          등록한 자료로 어떻게 답하는지 바로 확인하세요.
        </p>
        {savedProfile === null ? (
          <div className="skel h-32 !rounded-[16px]" />
        ) : savedProfile ? (
          /* token 없으면 자가 테스트가 익명 학생 질문으로 집계돼 인사이트를 오염시킴 */
          <ChatPanel teacherId={uid} teacherName={name || "나"} compact token={token} />
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
