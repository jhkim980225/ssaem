"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import ChatPanel from "@/components/ChatPanel";

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
  // allowNoProfile: 강사 가입 직후(프로필 저장 전)엔 role이 없다 — 대시보드에서 프로필을 만들어야 하므로 통과
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
    <main className="flex-1 w-full mx-auto px-5 lg:px-8 py-8 max-w-lg lg:max-w-[1600px]">
      <Dashboard session={session!} />
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

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [toneNote, setToneNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  // null = /api/profile 응답 전. false로 두면 이미 저장된 강사에게도 "먼저 저장하세요"가 잠깐 뜬다
  const [savedProfile, setSavedProfile] = useState<boolean | null>(null);
  const [invite, setInvite] = useState<{ url: string; qrSvg: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  // 평가 세트 (엑셀/CSV 업로드 시험)
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [asTitle, setAsTitle] = useState("");
  const [asCourse, setAsCourse] = useState("");
  const [asBusy, setAsBusy] = useState(false);

  const [courses, setCourses] = useState<Course[]>([]);
  const [newCourse, setNewCourse] = useState("");
  const [courseSel, setCourseSel] = useState(""); // "" = 공용 (모든 강좌에서 검색됨)
  // 목록 전용 상태. 자료가 수십 건이면 전부 그리는 것만으로 화면이 수천 px가 된다.
  const [docQuery, setDocQuery] = useState("");
  const [docCourse, setDocCourse] = useState(""); // "" = 전체
  const [docLimit, setDocLimit] = useState(PAGE);

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

  async function addCourse() {
    const title = newCourse.trim();
    if (!title) return;
    const r = await fetch("/api/courses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title }),
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "강좌 생성 실패", true);
    else {
      setNewCourse("");
      loadDocs();
    }
  }

  async function removeCourse(id: string) {
    if (!confirm("강좌를 삭제할까요? 담겨 있던 자료는 공용으로 바뀌어요.")) return;
    const r = await fetch(`/api/courses?id=${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      if (courseSel === id) setCourseSel("");
      loadDocs();
    } else say("강좌를 삭제하지 못했어요 — 다시 시도해 주세요.", true);
  }

  useEffect(() => {
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setName(d.profile.name ?? "");
          setSubject(d.profile.subject ?? "");
          setToneNote(d.profile.tone_note ?? "");
          setIsPublic(d.profile.is_public ?? true);
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
  }, [savedProfile, loadDocs, loadAssessments]);

  async function saveProfile() {
    say("");
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, subject, tone_note: toneNote, is_public: isPublic }),
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "저장 실패", true);
    else {
      setSavedProfile(true);
      say("프로필을 저장했어요");
    }
  }

  // 검색·강좌 필터를 적용한 목록. 원본 docs는 총계(개수·청크 수) 표시에 그대로 쓴다.
  const shownDocs = (docs ?? []).filter((d) => {
    if (docCourse === "none" ? d.course_id !== null : docCourse && d.course_id !== docCourse) return false;
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
      loadDocs();
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
    if (r.ok) loadDocs();
    else say("삭제하지 못했어요 — 다시 시도해 주세요.", true);
  }

  async function uploadPdf(file: File) {
    say("PDF 읽는 중…");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "problem");
    if (courseSel) fd.append("courseId", courseSel);
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "업로드 실패", true);
    else {
      say(`PDF를 등록했어요 (${d.chars}자)`);
      loadDocs();
    }
  }

  async function addDoc() {
    if (!content.trim()) return;
    say("");
    const r = await fetch("/api/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "problem", content, courseId: courseSel || null }),
    });
    const d = await r.json();
    if (!r.ok) say(d.error || "실패", true);
    else {
      setContent("");
      say("자료를 추가했어요");
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
      {/* 프로필 — 저장 후엔 접어둔다. 한 번 정하면 거의 안 건드리는데 최상단을 차지했다 */}
      <details className="rise d1 card p-5 lg:p-6" open={savedProfile !== true}>
        <summary className="font-bold text-[17px] cursor-pointer select-none list-none flex items-center justify-between gap-2">
          <span>
            내 프로필{" "}
            {savedProfile === false && <span className="text-blue text-[13px]">· 먼저 저장하세요</span>}
            {savedProfile === true && name && (
              <span className="text-sub text-[13px] font-normal">
                · {name}
                {subject ? ` · ${subject}` : ""}
              </span>
            )}
          </span>
          <span className="text-sub text-[13px] font-normal shrink-0">펼치기</span>
        </summary>
        <div className="flex flex-col gap-3 mt-3">
        <input className="field" placeholder="이름 (학생에게 표시)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field" placeholder="과목 (예: 전산회계 2급)" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea
          className="field min-h-20 resize-none"
          placeholder="말투·설명 방식 (선택. 예: 존댓말로 차근차근, 실무 예시 위주, 암기팁 곁들이기)"
          maxLength={500}
          value={toneNote}
          onChange={(e) => setToneNote(e.target.value)}
        />
        <label className="flex items-center gap-2 text-[14px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="w-4 h-4 accent-[var(--blue)]"
          />
          강사 목록에 내 프로필 공개
          <span className="text-sub text-[12px]">(끄면 초대받은 학생만 나를 볼 수 있어요)</span>
        </label>
        <button onClick={saveProfile} className="btn btn-primary py-3 self-start px-6">
          프로필 저장
        </button>
        </div>
      </details>

      {/* 학생 초대 */}
      {savedProfile === false && (
        <section className="rise d2 card p-5 lg:p-6">
          <h2 className="font-bold text-[17px]">먼저 프로필을 저장해 주세요</h2>
          <p className="text-sub text-[14px] mt-1.5 leading-relaxed">
            이름과 과목을 저장해야 자료 등록·학생 초대를 쓸 수 있어요. 위에서 저장하면 바로 열려요.
          </p>
        </section>
      )}

      {savedProfile && invite && (
        <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
          <h2 className="font-bold text-[17px]">학생 초대</h2>
          <p className="text-sub text-[13px] -mt-1">
            QR을 보여주거나 링크를 공유하세요. 학생이 접속하면 가입과 동시에 내 기본반에 등록돼요.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <div
              className="rounded-[14px] border border-line p-2 bg-white shrink-0 [&>svg]:block [&>svg]:w-[160px] [&>svg]:h-[160px]"
              dangerouslySetInnerHTML={{ __html: invite.qrSvg }}
            />
            <div className="flex flex-col gap-2 min-w-0 w-full">
              <p className="text-[12px] font-bold text-sub">초대 링크</p>
              <p className="text-[13px] break-all rounded-[10px] border border-line px-3 py-2.5" style={{ background: "var(--fill-2)" }}>
                {invite.url}
              </p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(invite.url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
                className="btn btn-ghost py-2.5 px-5 self-start text-[14px]"
              >
                {copied ? "복사됨 ✓" : "링크 복사"}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 강좌 */}
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">강좌</h2>
        <p className="text-sub text-[13px] -mt-1">
          강좌를 만들면 자료를 반별로 나눠 담을 수 있어요. 학생은 강좌를 골라 질문해요.
        </p>
        <div className="flex gap-2">
          <input
            className="field"
            placeholder="강좌 이름 (예: 전산회계 2급 야간반)"
            value={newCourse}
            onChange={(e) => setNewCourse(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) addCourse();
            }}
          />
          <button onClick={addCourse} className="btn btn-primary px-5 shrink-0">
            추가
          </button>
        </div>
        {courses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {courses.map((c) => (
              <span key={c.id} className="chip flex items-center gap-1.5">
                {c.title} <span className="text-sub">({c.documents})</span>
                <button onClick={() => removeCourse(c.id)} aria-label="강좌 삭제" className="text-sub">
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 자료 */}
      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h2 className="font-bold text-[17px]">학습 자료</h2>
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
        {courses.length > 0 && (
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

        {docs?.length === 0 && (
          <p className="text-sub text-[13px] mt-1">
            아직 등록된 자료가 없어요. 문제·풀이를 붙여넣거나 PDF를 올려보세요.
          </p>
        )}

        {docs && docs.length > 0 && (
          <div className="flex flex-col gap-2 mt-1">
            <p className="text-sub text-[13px]">
              등록된 자료 {docs.length}개 · 청크 {docs.reduce((s, d) => s + d.chunks, 0)}개
            </p>

            {/* 자료가 수십 건이면 전부 그리는 것만으로 화면이 수천 px가 되고, 원하는 자료를 못 찾는다 */}
            {docs.length > 5 && (
              <div className="flex gap-2 flex-wrap">
                <input
                  className="field !py-2.5 flex-1 min-w-[160px]"
                  placeholder="자료 검색 (제목·내용)"
                  value={docQuery}
                  onChange={(e) => {
                    setDocQuery(e.target.value);
                    setDocLimit(PAGE);
                  }}
                />
                {courses.length > 0 && (
                  <select
                    className="field !py-2.5 w-auto"
                    value={docCourse}
                    onChange={(e) => {
                      setDocCourse(e.target.value);
                      setDocLimit(PAGE);
                    }}
                  >
                    <option value="">모든 강좌</option>
                    <option value="none">공용</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
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
                    {/* 43건이 뒤섞이면 어느 강좌 자료인지 카드만 보고는 알 수 없다 */}
                    <span className="chip !py-0.5 !px-2 !text-[11px]">{d.course ?? "공용"}</span>
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

      {/* 평가 세트 */}
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

      {/* 자료 기록 (감사 로그) */}
      {events.length > 0 && (
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

      {/* 우측(PC) / 하단(모바일): 이동 + 자가 테스트 */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
      {/* 매일 보는 화면들 — 예전엔 스크롤 맨 아래에 있어 찾기 어려웠다 */}
      <section className="rise d1 card p-3 grid grid-cols-3 gap-2">
        {(
          [
            ["/teacher/insights", "인사이트", "질문 추이·자료 공백"],
            ["/teacher/history", "질문 이력", "미해결 큐"],
            ["/teacher/students", "학생 리포트", "학생별 활동"],
          ] as const
        ).map(([href, label, sub]) => (
          <Link
            key={href}
            href={href}
            className="rounded-[14px] border border-line px-2 py-3 text-center hover:bg-[var(--fill)] transition-colors"
            style={{ background: "var(--fill-2)" }}
          >
            <p className="text-[13px] font-bold">{label}</p>
            <p className="text-[11px] text-sub mt-0.5 leading-snug">{sub}</p>
          </Link>
        ))}
      </section>

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
