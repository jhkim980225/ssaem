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
    <div className="flex flex-col sm:flex-row gap-4 items-start">
      <div
        className="rounded-[14px] border border-line p-2 bg-white shrink-0 [&>svg]:block [&>svg]:w-[150px] [&>svg]:h-[150px]"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="flex flex-col gap-3 min-w-0 w-full">
        {/* 초대 링크 */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-bold text-sub">초대 링크</p>
          <p
            className="text-[13px] break-all rounded-[10px] border border-line px-3 py-2.5"
            style={{ background: "var(--fill-2)" }}
          >
            {url}
          </p>
          <button onClick={() => copy(url, "url")} className="btn btn-ghost py-2 px-4 self-start text-[13px]">
            {copied === "url" ? "복사됨 ✓" : "링크 복사"}
          </button>
        </div>

        {/* 초대 코드 (링크 없이 코드만 불러줄 때) */}
        <div className="flex flex-col gap-1.5">
          <p className="text-[12px] font-bold text-blue">초대 코드</p>
          <p
            className="text-[14px] font-bold break-all rounded-[10px] px-3 py-2.5 tabular-nums"
            style={{ background: "var(--blue-weak)", color: "var(--blue)" }}
          >
            {code}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => copy(code, "code")} className="btn btn-ghost py-2 px-4 text-[13px]">
              {copied === "code" ? "복사됨 ✓" : "코드 복사"}
            </button>
            <span className="text-[12px] text-sub">{hint}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
