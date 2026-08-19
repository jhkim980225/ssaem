"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import { supabase } from "@/lib/supabase";
import { TEACHER_REFRESH } from "@/components/TeacherSidebar";

// 강사 개인 설정 — 프로필(이름·과목·말투·공개)과 비밀번호 변경.
// 대시보드에 접혀 있던 프로필 폼을 여기로 옮겨 대시보드는 자료 관리에 집중한다.
export default function TeacherSettingsPage() {
  // allowNoProfile: 가입 직후 첫 프로필 저장도 이 화면에서 한다
  const { session, gate } = useGate("teacher", { allowNoProfile: true });

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [toneNote, setToneNote] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ text: string; err: boolean } | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  const token = session?.access_token;

  useEffect(() => {
    if (!token) return;
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) {
          setName(d.profile.name ?? "");
          setSubject(d.profile.subject ?? "");
          setToneNote(d.profile.tone_note ?? "");
          setIsPublic(d.profile.is_public ?? true);
        }
      })
      .finally(() => setLoaded(true));
  }, [token]);

  if (gate) return gate;

  async function saveProfile() {
    setMsg(null);
    const r = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, subject, tone_note: toneNote, is_public: isPublic }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) setMsg({ text: d?.error || "저장하지 못했어요.", err: true });
    else {
      setMsg({ text: "프로필을 저장했어요.", err: false });
      window.dispatchEvent(new Event(TEACHER_REFRESH)); // 사이드바 이름·과목 갱신
    }
  }

  async function changePassword() {
    if (pwBusy) return;
    if (pw.length < 8) return setPwMsg({ text: "비밀번호는 8자 이상으로 정해 주세요.", err: true });
    if (/^\d+$/.test(pw)) return setPwMsg({ text: "숫자만으로는 안 돼요. 영문을 섞어 주세요.", err: true });
    if (pw !== pw2) return setPwMsg({ text: "두 비밀번호가 서로 달라요.", err: true });
    setPwBusy(true);
    setPwMsg(null);
    try {
      const r = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setPwMsg({ text: d?.error || "비밀번호를 바꾸지 못했어요.", err: true });
      else {
        setPw("");
        setPw2("");
        setPwMsg({ text: "비밀번호를 바꿨어요.", err: false });
      }
    } catch {
      setPwMsg({ text: "네트워크 오류로 바꾸지 못했어요.", err: true });
    } finally {
      setPwBusy(false);
    }
  }

  const note = (m: { text: string; err: boolean } | null) =>
    m && (
      <p className={`text-[13px] ${m.err ? "" : "text-blue"}`} style={m.err ? { color: "var(--red)" } : undefined}>
        {m.text}
      </p>
    );

  return (
    <main className="flex-1 w-full mx-auto px-5 py-8 max-w-lg lg:max-w-2xl flex flex-col gap-4">
      <div className="rise">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">개인 설정</h1>
      </div>

      <section className="rise d1 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">내 프로필</h2>
        {!loaded ? (
          <div className="flex flex-col gap-2">
            <div className="skel h-12 !rounded-[14px]" />
            <div className="skel h-12 !rounded-[14px]" />
          </div>
        ) : (
          <>
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
            {note(msg)}
          </>
        )}
      </section>

      <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-3">
        <h2 className="font-bold text-[17px]">비밀번호 변경</h2>
        <input
          className="field"
          type="password"
          placeholder="새 비밀번호 (8자 이상, 영문 포함)"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="새 비밀번호 확인"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && changePassword()}
        />
        <button onClick={changePassword} disabled={pwBusy} className="btn btn-gray py-3 self-start px-6 disabled:opacity-60">
          {pwBusy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
        {note(pwMsg)}
      </section>

      <section className="rise d3 card p-5 lg:p-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-[17px]">로그아웃</h2>
          <p className="text-sub text-[13px]">이 기기에서 내 계정을 로그아웃해요.</p>
        </div>
        <button onClick={() => supabase.auth.signOut()} className="btn btn-gray py-2.5 px-5 shrink-0">
          로그아웃
        </button>
      </section>
    </main>
  );
}
