import QRCode from "qrcode";
import { headers } from "next/headers";
import InstallGuide from "./InstallGuide";

// 설치 안내 — 원장/강사가 이 화면을 띄워두면 학생이 QR 찍고 홈 화면에 추가.
// 스토어 등록 없이 PWA로 설치. 단계 안내는 기기별로 달라서 클라이언트(InstallGuide)가 감지해 보여준다.
export default async function InstallPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  // QR은 이 안내 페이지로 보낸다. /ask로 보내면 로그인 필수라 학생이 설치 안내를 보지도 못한다.
  const url = `${proto}://${host}/install`;
  // 홈 화면에 추가할 때 iOS(16.4 미만)는 "그때 열려 있던 URL"을 앱 시작 주소로 박는다.
  // 그래서 설치는 이 안내 페이지가 아니라 앱 시작 화면(/)에서 하게 안내한다.
  const appUrl = `${proto}://${host}/`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 260 });


  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-8">
      <h1 className="rise text-[24px] lg:text-[28px] font-extrabold tracking-tight">앱으로 설치하기</h1>
      <p className="rise d1 text-sub text-[15px] mt-2 leading-relaxed">
        스토어에서 받지 않아도 돼요. QR을 찍고 홈 화면에 추가하면 앱처럼 열려요.
      </p>

      <div className="rise d2 mt-8 grid gap-5 sm:grid-cols-[260px_minmax(0,1fr)] items-start">
        <div className="card p-4">
          <div
            className="rounded-[14px] bg-white p-2 [&>svg]:block [&>svg]:w-full [&>svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p className="mt-3 text-[12px] text-sub break-all text-center">{url}</p>
        </div>

        <InstallGuide url={url} appUrl={appUrl} />
      </div>
    </main>
  );
}
