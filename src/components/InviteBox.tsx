"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

// 유효 기간 선택지 — 0 = 무기한(부모가 준 기존 코드 그대로)
const TERMS = [
  [0, "무기한"],
  [7, "7일"],
  [30, "30일"],
] as const;
type Days = (typeof TERMS)[number][0];
type Alt = { base: string; days: Days; url: string; qrSvg: string; expiresOn: string | null };

// 초대 QR + 링크 + **코드만 따로**.
//
// 링크만 주면 "어디부터가 코드인지" 매번 헷갈린다(주소와 코드가 한 줄에 붙어 있어서).
// 코드를 따로 떼서 각각 복사 버튼을 달아둔다 — 링크를 보내도 되고 코드만 불러줘도 된다.
// 유효 기간을 고르면 /api/invite?from=에서 만료형 코드를 받아 QR·링크·코드를 통째로 바꾼다
// (부모는 무기한 코드만 넘긴다 — 강사·원장 화면 어디에 붙어도 같은 길).
export default function InviteBox({
  url: baseUrl,
  qrSvg: baseQr,
  hint,
}: {
  url: string;
  qrSvg: string;
  /** 코드 아래 한 줄 안내 (누가 어디에 넣는지) */
  hint: string;
}) {
  const [copied, setCopied] = useState<"url" | "code" | null>(null);
  const [alt, setAlt] = useState<Alt | null>(null);
  const [loading, setLoading] = useState<Days | null>(null);
  const [err, setErr] = useState("");

  // 부모가 다른 코드(다른 ROOM)를 넘기면 만료판은 버린다 — 이전 ROOM 코드가 남으면 사고
  const cur = alt?.base === baseUrl ? alt : null;
  const days: Days = cur?.days ?? 0;
  const url = cur?.url ?? baseUrl;
  const qrSvg = cur?.qrSvg ?? baseQr;

  // 코드 = 마지막 "/" 뒤. 링크 형식이 바뀌어도 이 규칙 하나만 지키면 된다.
  const code = url.split("/").pop() ?? "";

  function copy(text: string, which: "url" | "code") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  async function pick(d: Days) {
    setErr("");
    if (d === 0) return setAlt(null);
    if (loading !== null) return;
    setLoading(d);
    try {
      const { data } = await supabase.auth.getSession();
      const baseCode = baseUrl.split("/").pop() ?? "";
      const r = await fetch(`/api/invite?from=${encodeURIComponent(baseCode)}&days=${d}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.url) return setErr(j?.error ?? "기간 코드를 만들지 못했어요");
      setAlt({ base: baseUrl, days: d, url: j.url, qrSvg: j.qrSvg, expiresOn: j.expiresOn ?? null });
    } catch {
      setErr("기간 코드를 만들지 못했어요");
    } finally {
      setLoading(null);
    }
  }

  const until = cur?.expiresOn ? cur.expiresOn.split("-").map(Number) : null;

  return (
    <div className="flex flex-col gap-3">
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

      {/* 유효 기간 — 링크가 새도 기간이 지나면 못 쓴다. 기존 무기한 코드는 그대로 유효 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] text-sub mr-1">유효 기간</span>
        {TERMS.map(([d, label]) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => pick(d)}
            className={`chip !py-1 !px-3 !text-[13px] ${days === d ? "chip-on" : ""}`}
          >
            {loading === d ? "…" : label}
          </button>
        ))}
      </div>
      {err ? (
        <p className="text-[12px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      ) : until ? (
        <p className="text-[12px] text-sub -mt-1.5">
          <b className="text-text">
            {until[1]}월 {until[2]}일
          </b>
          까지 쓸 수 있어요. 이전에 나눠준 무기한 코드도 계속 열려 있어요.
        </p>
      ) : null}
    </div>
  );
}
