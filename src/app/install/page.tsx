import QRCode from "qrcode";
import { headers } from "next/headers";
import InstallGuide from "./InstallGuide";

// 설치 안내 — 원장/강사가 이 화면을 띄워두면 학생이 QR 찍고 홈 화면에 추가.
// 스토어 등록 없이 PWA로 설치. 단계 안내는 기기별로 달라서 클라이언트(InstallGuide)가 감지해 보여준다.
export default async function InstallPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const url = `${proto}://${host}/ask`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 260 });


  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-12">
      <h1 className="rise text-[26px] lg:text-[32px] font-extrabold tracking-tight">앱으로 설치하기</h1>
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

        <InstallGuide url={url} />
      </div>
    </main>
  );
}
