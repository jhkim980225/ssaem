import type { MetadataRoute } from "next";

// PWA 매니페스트 — 스토어 없이 홈 화면 설치. 아이콘은 /pwa-icon/<size>에서 동적 생성(바이너리 자산 없음).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "마스터 전산회계 학원",
    short_name: "마스터 전산회계",
    description: "선생님이 올린 자료를 근거로 답하는 학원 전용 AI 튜터",
    // 학생이 설치 후 열면 바로 질문 화면
    start_url: "/ask",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#3d6bf4",
    lang: "ko",
    categories: ["education"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
