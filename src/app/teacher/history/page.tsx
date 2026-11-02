"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import { renderMd } from "@/components/Markdown";

type Conv = {
  id: string;
  title: string | null;
  created_at: string;
  messages: number;
  needs_review?: boolean;
  student_name: string | null; // null = 비로그인으로 질문(또는 탈퇴한 학생)
};
type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  rating: number | null;
};

export default function HistoryPage() {
  const { session, gate, allowed } = useGate("teacher");
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({});
  const [msgErr, setMsgErr] = useState<Record<string, string>>({});
  const [onlyFlagged, setOnlyFlagged] = useState(false); // 미해결(👎) 큐 필터

  useEffect(() => {
    if (!allowed || !session) return;
    fetch("/api/conversations", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setConvs(d.conversations ?? []))
      .catch(() => setConvs([]));
  }, [allowed, session]);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (msgs[id] || !session) return;
    const r = await fetch(`/api/conversations?id=${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const d = await r.json().catch(() => null);
    // 실패를 남기지 않으면 스켈레톤이 영영 안 걷힌다. 다시 열면 재시도.
    setMsgErr((e) => ({ ...e, [id]: r.ok ? "" : d?.error ?? "대화를 불러오지 못했어요." }));
    if (r.ok) setMsgs((m) => ({ ...m, [id]: d?.messages ?? [] }));
  }

  if (gate) return gate;

  const shown = convs?.filter((c) => !onlyFlagged || c.needs_review) ?? [];

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1000px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">학생 질문 이력</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">학생들이 내 튜터에게 물어본 내용이에요.</p>
      </div>

      {/* 미해결 큐 — 👎 받은 대화만 모아 강사가 보완 (AI 한계를 강사 개입으로) */}
      {(convs?.some((c) => c.needs_review) ?? false) && (
        <div className="rise d1 flex gap-2">
          <button onClick={() => setOnlyFlagged(false)} className={`chip ${!onlyFlagged ? "chip-on font-bold" : ""}`}>
            전체
          </button>
          <button onClick={() => setOnlyFlagged(true)} className={`chip ${onlyFlagged ? "chip-on font-bold" : ""}`}>
            확인 필요 {convs?.filter((c) => c.needs_review).length}
          </button>
        </div>
      )}

      {convs === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-16 !rounded-[16px]" />
          ))}
        </div>
      )}

      {convs?.length === 0 && (
        <div className="rise d1 card p-10 text-center">
          <p className="text-sub text-[14px]">아직 질문이 없어요.</p>
        </div>
      )}

      {shown.length > 0 && (
      <section className="rise d2 card overflow-hidden py-1">
        {shown.map((c, i) => (
          <div key={c.id} className={i > 0 ? "border-t border-line" : ""}>
            <button
              onClick={() => toggle(c.id)}
              aria-expanded={openId === c.id}
              className="w-full text-left px-5 py-4 lg:px-6 lg:py-5 cursor-pointer transition-colors hover:bg-[var(--fill-2)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {c.needs_review && (
                  <span
                    className="inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold shrink-0"
                    style={{ color: "var(--red)", background: "var(--red-weak)" }}
                  >
                    확인 필요
                  </span>
                )}
                <p className="flex-1 basis-[180px] min-w-0 font-bold text-[15px] lg:text-[16px] truncate">
                  {c.title || "제목 없음"}
                </p>
                <span className="text-sub text-[13px] shrink-0">
                  {c.student_name ?? "비로그인 학생"} · 메시지 {c.messages} ·{" "}
                  {new Date(c.created_at).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>
            {openId === c.id && (
              <div className="px-5 lg:px-6 pb-5">
                <div className="rounded-[12px] p-3 lg:p-4 flex flex-col gap-2.5" style={{ background: "var(--fill-2)" }}>
                  {!msgs[c.id] && !msgErr[c.id] && <div className="skel h-10" />}
                  {msgErr[c.id] && (
                    <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
                      {msgErr[c.id]}
                    </p>
                  )}
                  {msgs[c.id]?.map((m) =>
                    m.role === "user" ? (
                      /* PC에서 폭을 넓힌 뒤로 말풍선이 한 줄 60자를 넘어 눈이 못 따라간다 — 읽기 폭 상한 */
                      <div key={m.id} className="self-end max-w-[85%] lg:max-w-[620px] px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap bg-blue text-white rounded-[12px] rounded-br-[4px]">
                        {m.content}
                      </div>
                    ) : (
                      <div key={m.id} className="self-start max-w-[92%] lg:max-w-[680px] flex flex-col gap-1">
                        <div
                          className="md min-w-0 px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap rounded-[12px] rounded-tl-[4px] border border-line"
                          style={{ background: "var(--surface)" }}
                        >
                          {renderMd(m.content)}
                        </div>
                        {m.rating !== null && (
                          <span
                            className={`text-[13px] pl-1 ${m.rating >= 4 ? "text-sub" : "font-semibold"}`}
                            style={m.rating >= 4 ? undefined : { color: "var(--red)" }}
                          >
                            학생 평가: {m.rating >= 4 ? "도움됨" : "도움 안 됨"}
                          </span>
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </section>
      )}
    </main>
  );
}
