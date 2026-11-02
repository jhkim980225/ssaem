"use client";

// 루트 레이아웃까지 죽었을 때의 최후 화면 — 전역 CSS도 못 믿는 상황이라 인라인 스타일만 쓴다.
// 색은 globals.css 라이트 팔레트 값 복제 (토큰을 못 쓰므로). 가운데 아이콘·제목·설명 + 하단 꽉 찬 버튼.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          fontFamily: "Pretendard, -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', sans-serif",
          background: "#ffffff",
          color: "#191f28",
        }}
      >
        <div
          style={{
            maxWidth: 400,
            margin: "0 auto",
            minHeight: "100dvh",
            boxSizing: "border-box",
            padding: "20px 24px 32px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 14,
            }}
          >
            <span
              style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: "#fcefef",
                color: "#c53030",
                display: "grid",
                placeItems: "center",
              }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v5M12 16h.01" />
              </svg>
            </span>
            <h1 style={{ margin: "6px 0 0", fontSize: 22, fontWeight: 700 }}>잠시 문제가 생겼어요</h1>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#6b7280" }}>
              잠시 후 다시 시도해 주세요.{error.digest ? ` (코드: ${error.digest})` : ""}
            </p>
          </div>
          <button
            onClick={reset}
            style={{
              height: 50,
              width: "100%",
              borderRadius: 12,
              border: "none",
              background: "#1e3a5f",
              color: "#fff",
              fontFamily: "inherit",
              fontWeight: 700,
              fontSize: 17,
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
