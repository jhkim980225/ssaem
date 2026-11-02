"use client";
import { useState } from "react";

// 초대 QR + 링크 + **코드만 따로**.
//
// 링크만 주면 "어디부터가 코드인지" 매번 헷갈린다(주소와 코드가 한 줄에 붙어 있어서).
// 코드를 따로 떼서 각각 복사 버튼을 달아둔다 — 링크를 보내도 되고 코드만 불러줘도 된다.
export default function InviteBox({
  url,
  qrSvg,
  hint,
}: {
  url: string;
  qrSvg: string;
  /** 코드 아래 한 줄 안내 (누가 어디에 넣는지) */
  hint: string;
}) {
  const [copied, setCopied] = useState<"url" | "code" | null>(null);

  // 코드 = 마지막 "/" 뒤. 링크 형식이 바뀌어도 이 규칙 하나만 지키면 된다.
  const code = url.split("/").pop() ?? "";

  function copy(text: string, which: "url" | "code") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="flex gap-3.5 items-start">
      {/* QR은 다크 모드에서도 흰 바탕이어야 읽힌다 */}
      <div
        className="rounded-[10px] border border-line p-1.5 bg-white shrink-0 [&>svg]:block [&>svg]:w-[84px] [&>svg]:h-[84px] sm:[&>svg]:w-[108px] sm:[&>svg]:h-[108px]"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="flex flex-col gap-2 min-w-0 flex-1">
        {/* 초대 코드 (링크 없이 코드만 불러줄 때) */}
        <div>
          <p className="text-[13px] text-sub">초대 코드</p>
          <p className="text-[20px] lg:text-[22px] font-bold tracking-[1px] break-all tabular-nums text-blue">{code}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => copy(code, "code")} className="btn btn-ghost h-9 px-3 text-[13px]">
            {copied === "code" ? "복사됨 ✓" : "코드 복사"}
          </button>
          <button onClick={() => copy(url, "url")} className="btn btn-gray h-9 px-3 text-[13px] font-semibold">
            {copied === "url" ? "복사됨 ✓" : "링크 복사"}
          </button>
        </div>
        {/* 초대 링크 — 주소 전체도 보이게 (받아 적거나 직접 확인할 때) */}
        <p className="text-[12px] text-sub break-all">{url}</p>
        <p className="text-[12px] text-sub">{hint}</p>
      </div>
    </div>
  );
}
