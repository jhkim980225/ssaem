import QRCode from "qrcode";
import { headers } from "next/headers";
import InstallButton from "./InstallButton";

// 설치 안내 — 원장/강사가 이 화면을 띄워두면 학생이 QR 찍고 홈 화면에 추가.
// 스토어 등록 없이 PWA로 설치 (iOS는 수동 추가, Android는 설치 배너).
export default async function InstallPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  const url = `${proto}://${host}/ask`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 260 });

  const STEPS = [
    {
      os: "아이폰 (Safari)",
      items: [
        "QR을 찍어 사이트가 열리면 아래 공유 버튼을 누르세요.",
        "목록에서 '홈 화면에 추가'를 고르세요.",
        "오른쪽 위 '추가'를 누르면 끝이에요.",
      ],
      note: "사파리에서만 추가할 수 있어요. 크롬으로 열렸다면 주소를 사파리에 붙여넣어 주세요.",
    },
    {
      os: "안드로이드 (크롬)",
      items: [
        "QR을 찍어 사이트가 열리면 '앱 설치' 안내가 뜹니다.",
        "안 뜨면 오른쪽 위 점 세 개를 누르세요.",
        "'앱 설치' 또는 '홈 화면에 추가'를 고르면 끝이에요.",
      ],
      note: "설치하면 주소창 없이 앱처럼 열려요.",
    },
  ];

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

        <div className="flex flex-col gap-4">
          <InstallButton />
          {STEPS.map((s) => (
            <section key={s.os} className="card p-5">
              <h2 className="text-[15px] font-extrabold">{s.os}</h2>
              <ol className="mt-2.5 flex flex-col gap-1.5">
                {s.items.map((t, i) => (
                  <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
                    <span className="shrink-0 grid place-items-center w-5 h-5 rounded-full bg-blue text-white text-[11px] font-extrabold mt-0.5">
                      {i + 1}
                    </span>
                    {t}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[12px] text-sub leading-relaxed">{s.note}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
