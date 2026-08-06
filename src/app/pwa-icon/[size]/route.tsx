import { ImageResponse } from "next/og";

// PWA 아이콘 동적 생성 (192·512). 바이너리 자산을 레포에 두지 않으려고 next/og로 렌더.
// maskable 대응: 세이프존(중앙 80%) 안에만 글자를 둔다.
const ALLOWED = new Set([192, 512]);

export function generateStaticParams() {
  return [...ALLOWED].map((s) => ({ size: String(s) }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size: raw } = await params;
  const size = Number(raw);
  if (!ALLOWED.has(size)) return new Response("not found", { status: 404 });

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
          fontSize: size * 0.42,
          fontWeight: 800,
          letterSpacing: -size * 0.02,
        }}
      >
        AI
      </div>
    ),
    { width: size, height: size }
  );
}
