"use client";

// 루트 레이아웃까지 죽었을 때의 최후 화면 — 전역 CSS도 못 믿는 상황이라 인라인 스타일만 쓴다.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "Pretendard, sans-serif",
          background: "#ffffff",
          color: "#16171d",
        }}
      >
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 40, margin: 0 }}>⚠️</p>
          <p style={{ fontWeight: 800, fontSize: 17, margin: "8px 0 4px" }}>일시적인 문제가 생겼어요</p>
          <p style={{ color: "#73778a", fontSize: 14, margin: 0 }}>
            잠시 후 다시 시도해 주세요.{error.digest ? ` (코드: ${error.digest})` : ""}
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 20,
              padding: "12px 24px",
              borderRadius: 12,
              border: "none",
              background: "#3d6bf4",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
