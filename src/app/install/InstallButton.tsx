"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

// 이미 설치돼 standalone으로 열렸는지 — 외부(브라우저) 상태라 구독으로 읽는다.
// 서버 스냅샷은 false: 서버에선 알 수 없고, 클라이언트에서 정정된다.
function subscribeStandalone(cb: () => void) {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

// Android/데스크톱 크롬만 beforeinstallprompt를 준다. iOS는 이벤트가 없어 버튼을 숨기고 수동 안내로 유도.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function InstallButton() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [done, setDone] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    () => window.matchMedia("(display-mode: standalone)").matches,
    () => false
  );
  const installed = standalone || justInstalled;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // 기본 배너 대신 우리 버튼으로
      setEvt(e as InstallPromptEvent);
    };
    const onInstalled = () => setJustInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed)
    return (
      <p className="card p-4 text-[14px] font-bold text-blue" style={{ background: "var(--blue-weak)", borderColor: "transparent" }}>
        이미 설치돼 있어요.
      </p>
    );

  if (!evt) return null;

  return (
    <button
      onClick={async () => {
        await evt.prompt();
        const { outcome } = await evt.userChoice;
        setEvt(null);
        if (outcome === "accepted") setDone(true);
      }}
      className="btn btn-primary py-4 text-[15px]"
    >
      {done ? "설치 중…" : "이 기기에 바로 설치하기"}
    </button>
  );
}
