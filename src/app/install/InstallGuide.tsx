"use client";
import { useState, useSyncExternalStore } from "react";
import InstallButton from "./InstallButton";

type Platform = "ios-safari" | "ios-other" | "android" | "desktop" | "unknown";

// 기기·브라우저를 보고 자기한테 필요한 단계만 보여준다.
// iOS는 beforeinstallprompt가 없어(애플 미구현) 버튼으로 설치를 못 걸므로 수동 안내가 유일한 수단이고,
// 그래서 "어느 버튼을 누르라"를 정확히 짚어주는 게 설치율을 좌우한다.
function detect(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) {
    // iOS는 모든 브라우저가 WebKit이지만 '홈 화면에 추가'는 사파리에만 있다
    const inSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|NAVER|KAKAOTALK|Instagram|FBAN|FBAV|Line/i.test(ua);
    return inSafari ? "ios-safari" : "ios-other";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

const GUIDES: Record<Exclude<Platform, "unknown">, { title: string; steps: string[]; note?: string }> = {
  "ios-safari": {
    title: "아이폰 · 3단계면 끝나요",
    steps: [
      "화면 아래 가운데 공유 버튼(⬆︎이 든 네모)을 누르세요.",
      "목록을 조금 내려 '홈 화면에 추가'를 누르세요.",
      "오른쪽 위 '추가'를 누르면 홈 화면에 아이콘이 생겨요.",
    ],
    note: "아이폰은 애플 정책상 자동 설치 버튼을 띄울 수 없어요. 이 3단계가 유일한 방법이에요.",
  },
  "ios-other": {
    title: "사파리로 열어야 설치돼요",
    steps: [
      "지금 브라우저(카카오톡·크롬 등)에서는 홈 화면 추가가 안 돼요.",
      "아래 '주소 복사'를 누르고 사파리 주소창에 붙여넣으세요.",
      "사파리에서 열리면 공유 → '홈 화면에 추가'로 설치돼요.",
    ],
  },
  android: {
    title: "안드로이드 · 버튼 한 번이면 끝나요",
    steps: [
      "아래 '이 기기에 바로 설치하기'를 누르세요.",
      "버튼이 안 보이면 오른쪽 위 점 세 개(⋮)를 누르세요.",
      "'앱 설치' 또는 '홈 화면에 추가'를 고르면 끝이에요.",
    ],
  },
  desktop: {
    title: "휴대폰으로 QR을 찍어 주세요",
    steps: [
      "학생 휴대폰 카메라로 왼쪽 QR을 찍으세요.",
      "열린 화면에서 기기에 맞는 설치 안내가 나와요.",
      "PC에서도 주소창 오른쪽 설치 아이콘으로 설치할 수 있어요.",
    ],
  },
};

export default function InstallGuide({ url }: { url: string }) {
  // 서버 렌더에는 navigator가 없다 → 서버 스냅샷은 "unknown", 클라이언트에서 정정된다.
  // useSyncExternalStore를 쓰면 이펙트에서 setState 하지 않아도 되고 하이드레이션 불일치도 없다.
  const platform = useSyncExternalStore(
    () => () => {}, // UA는 바뀌지 않으므로 구독할 것이 없다
    detect,
    () => "unknown" as Platform
  );
  const [copied, setCopied] = useState(false);

  // 감지 전엔 자리만 잡아둔다 (잘못된 안내가 잠깐이라도 보이면 안 됨)
  if (platform === "unknown") return <div className="skel h-52 !rounded-[20px]" />;

  const g = GUIDES[platform];

  return (
    <div className="flex flex-col gap-4">
      <InstallButton />

      <section className="card p-5 lg:p-6">
        <h2 className="text-[16px] font-extrabold">{g.title}</h2>
        <ol className="mt-3 flex flex-col gap-2.5">
          {g.steps.map((t, i) => (
            <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
              <span className="shrink-0 grid place-items-center w-5 h-5 rounded-full bg-blue text-white text-[11px] font-extrabold mt-0.5">
                {i + 1}
              </span>
              {t}
            </li>
          ))}
        </ol>
        {g.note && <p className="mt-3 text-[12px] text-sub leading-relaxed">{g.note}</p>}

        {(platform === "ios-other" || platform === "ios-safari") && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className="btn btn-gray py-3 px-5 mt-4 text-[14px]"
          >
            {copied ? "복사됐어요" : "주소 복사"}
          </button>
        )}
      </section>

      {/* 다른 기기 안내는 접어둔다 — 자기 기기 단계만 보이는 게 설치율에 유리 */}
      <details className="card p-5">
        <summary className="text-[14px] font-bold cursor-pointer select-none">
          다른 기기에서 설치하려면
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          {(Object.keys(GUIDES) as (keyof typeof GUIDES)[])
            .filter((k) => k !== platform)
            .map((k) => (
              <div key={k}>
                <p className="text-[13px] font-bold">{GUIDES[k].title}</p>
                <ol className="mt-1 flex flex-col gap-1">
                  {GUIDES[k].steps.map((t, i) => (
                    <li key={t} className="text-[13px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
                      {i + 1}. {t}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
        </div>
      </details>
    </div>
  );
}
