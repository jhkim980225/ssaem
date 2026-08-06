import { ImageResponse } from "next/og";

// iOS 홈 화면 아이콘. iOS는 매니페스트 icons를 무시하고 apple-touch-icon을 쓴다.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#3d6bf4",
          color: "#ffffff",
          fontSize: 76,
          fontWeight: 800,
        }}
      >
        AI
      </div>
    ),
    size
  );
}
