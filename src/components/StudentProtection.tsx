"use client";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";

// 학생 계정 유출 억제.
//
// ⚠️ 스크린샷 자체(OS 캡처·다른 기기로 촬영)는 웹에서 막을 수 없다. 여기서 막는 건
// 드래그앤드롭·복사·텍스트선택·우클릭·이미지 끌어저장 + 학생 식별 워터마크로,
// "긁어가기 수고를 늘리고 유출본을 추적 가능하게" 하는 억제책이다.
// 질문·답안 입력창에서는 정상 동작하도록 예외를 둔다.

function isEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || n.isContentEditable;
}

function xmlEscape(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

export default function StudentProtection() {
  const { role, session } = useAuth();
  const isStudent = role === "student";

  useEffect(() => {
    if (!isStudent) return;
    // 입력창(질문·답안)에서는 허용, 그 밖에서는 차단
    const block = (e: Event) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    };
    const events = ["contextmenu", "dragstart", "copy", "cut", "selectstart"] as const;
    for (const ev of events) document.addEventListener(ev, block);
    document.body.classList.add("student-locked");
    return () => {
      for (const ev of events) document.removeEventListener(ev, block);
      document.body.classList.remove("student-locked");
    };
  }, [isStudent]);

  if (!isStudent) return null;

  // 워터마크 라벨: 로그인 아이디(내부 이메일 로컬파트) + uid 앞 6자 → 유출본 추적용
  const label = xmlEscape(
    session
      ? `${(session.user.email ?? "").split("@")[0] || "학생"} · ${session.user.id.slice(0, 6)}`
      : "학생"
  );
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='170'>` +
      `<text x='8' y='90' transform='rotate(-24 150 90)' fill='rgba(130,130,130,0.13)' ` +
      `font-size='14' font-family='sans-serif'>${label}</text></svg>`
  );

  // pointer-events:none — 클릭·UX엔 영향 없고 화면 캡처엔 함께 찍힌다
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9998,
        pointerEvents: "none",
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        backgroundRepeat: "repeat",
      }}
    />
  );
}
