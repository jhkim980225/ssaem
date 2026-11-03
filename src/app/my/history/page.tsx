"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { avatarEmoji } from "@/lib/avatar";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import { renderMd } from "@/components/Markdown";

type Conv = {
  id: string;
  title: string | null;
  created_at: string;
  teacher_id: string;
  teacher_name: string | null;
  messages: number;
};
type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string; rating: number | null };

// 학생 대화내역 — /ask 좌측 목록은 좁아서, 전체를 펼쳐 보는 전용 화면.
export default function MyHistoryPage() {
  const { session, gate, allowed } = useGate("student", { loginMessage: "대화내역은 계정에 저장돼요." });
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({});
  const [msgErr, setMsgErr] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState<string | null>(null);
  const [delErr, setDelErr] = useState("");

  useEffect(() => {
    if (!allowed || !session) return;
    fetch("/api/conversations", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setConvs(d.conversations ?? []))
      .catch(() => setConvs([]));
  }, [allowed, session]);

  async function toggle(id: string) {
    if (openId === id) {
      // PC(마스터-디테일)에선 재클릭으로 선택이 풀리면 우측 패널이 비어 어색하다 — 유지.
      // 모바일 아코디언은 재클릭 = 접기 그대로.
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      return setOpenId(null);
    }
    setOpenId(id);
    setDelErr("");
    if (msgs[id] || !session) return;
    const r = await fetch(`/api/conversations?id=${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const d = await r.json().catch(() => null);
    // 실패를 남기지 않으면 스켈레톤이 영영 안 걷힌다. 다시 열면 재시도.
    setMsgErr((e) => ({ ...e, [id]: r.ok ? "" : d?.error ?? "대화를 불러오지 못했어요." }));
    if (r.ok) setMsgs((m) => ({ ...m, [id]: d?.messages ?? [] }));
  }

  async function remove(c: Conv) {
    if (deleting || !session) return;
    if (!confirm(`"${c.title || "제목 없음"}" 대화를 삭제할까요?
주고받은 내용이 모두 지워지고 되돌릴 수 없어요.`)) return;
    setDeleting(c.id);
    setDelErr("");
    try {
      const r = await fetch(`/api/conversations?id=${c.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setDelErr(d?.error ?? "삭제하지 못했어요.");
      setConvs((l) => (l ?? []).filter((x) => x.id !== c.id));
      setOpenId(null);
    } catch {
      setDelErr("네트워크 오류로 삭제하지 못했어요.");
    } finally {
      setDeleting(null);
    }
  }

  if (gate) return gate;

  const totalMsgs = (convs ?? []).reduce((s, c) => s + c.messages, 0);
  const openConv = convs?.find((c) => c.id === openId) ?? null;

  // 대화 본문 — 모바일 아코디언과 PC 우측 패널이 같이 쓴다
  const detailBody = (c: Conv) => (
    <>
      <div className="rounded-[12px] p-3.5 flex flex-col gap-2.5" style={{ background: "var(--fill-2)" }}>
        {!msgs[c.id] && !msgErr[c.id] && <div className="skel h-10" />}
        {msgErr[c.id] && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {msgErr[c.id]}
          </p>
        )}
        {msgs[c.id]?.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="self-end max-w-[80%] px-3.5 py-2.5 text-[14px] leading-normal whitespace-pre-wrap bg-blue text-white rounded-[12px] rounded-br-[4px]"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="self-start max-w-[85%] flex flex-col gap-1">
              <div className="md min-w-0 px-3.5 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap rounded-[12px] rounded-tl-[4px] bg-surface border border-line">
                {renderMd(m.content)}
              </div>
              {m.rating !== null && (
                <span className="text-sub text-[13px] pl-1">
                  내 평가: {m.rating >= 4 ? "도움됐어요" : "아쉬워요"}
                </span>
              )}
            </div>
          )
        )}
      </div>
      <Link
        href={`/ask?teacher=${c.teacher_id}`}
        className="btn btn-ghost !rounded-[8px] h-11 text-[14px] flex items-center justify-center"
      >
        이 선생님께 새로 질문하기
      </Link>
      {delErr && (
        <p role="alert" className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {delErr}
        </p>
      )}
      <button
        onClick={() => remove(c)}
        disabled={deleting !== null}
        className="self-center text-[13px] font-semibold cursor-pointer disabled:opacity-40"
        style={{ color: "var(--red)" }}
      >
        {deleting === c.id ? "삭제 중…" : "대화 삭제"}
      </button>
    </>
  );

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-5xl mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center justify-between gap-3">
        <BackButton fallback="/ask" />
        <Link href="/ask" className="chip shrink-0 !text-[13px]">
          질문하기
        </Link>
      </header>
      <section className="rise px-1 pb-1">
        <h1 className="text-[24px] lg:text-[28px] font-bold mb-1.5">내 대화내역</h1>
        <p className="text-sub text-[15px] tabular-nums">
          {convs && convs.length > 0
            ? `대화 ${convs.length} · 주고받은 글 ${totalMsgs}`
            : "지금까지 선생님께 물어본 내용이에요."}
        </p>
      </section>

      {convs === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-16 !rounded-[16px]" />
          ))}
        </div>
      )}

      {convs?.length === 0 && (
        <>
          <section className="rise d1 card min-h-[320px] px-6 py-8 flex flex-col items-center justify-center text-center gap-2.5">
            <span className="grid place-items-center w-[72px] h-[72px] rounded-[16px] text-blue" style={{ background: "var(--blue-weak)" }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
              </svg>
            </span>
            <h2 className="mt-1.5 text-[20px] font-bold">아직 대화가 없어요</h2>
            <p className="text-sub text-[15px] leading-relaxed break-keep">
              수업 중 헷갈린 부분을 물어보면
              <br />
              여기에 차곡차곡 쌓여요.
            </p>
          </section>
          <Link href="/ask" className="rise d2 btn btn-primary h-[50px] text-[17px] flex items-center justify-center lg:self-center lg:px-10">
            질문하러 가기
          </Link>
        </>
      )}

      {/* PC에선 좌(목록) / 우(대화 내용 sticky) 마스터-디테일, 모바일은 아코디언 그대로 */}
      <div className="lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      {convs && convs.length > 0 && (
        <section className="rise d1 card py-1 overflow-hidden">
          {convs.map((c, i) => {
            const isOpen = openId === c.id;
            return (
              <article key={c.id} className={i > 0 ? "border-t border-line" : ""}>
                <button
                  onClick={() => toggle(c.id)}
                  aria-expanded={isOpen}
                  className={`w-full text-left px-5 py-4 cursor-pointer flex items-center gap-3 transition-colors ${
                    isOpen ? "lg:bg-[var(--blue-weak)]" : "hover:bg-[var(--fill-2)]"
                  }`}
                >
                  <span className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-blue text-white font-bold">
                    {avatarEmoji(c.teacher_name ?? "선생님")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[16px] truncate">{c.title || "제목 없음"}</p>
                    <p className="text-sub text-[13px] truncate mt-0.5">
                      {c.teacher_name ?? "선생님"} · {c.messages}개 ·{" "}
                      {new Date(c.created_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                    </p>
                  </div>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 text-sub transition-transform lg:-rotate-90 ${isOpen ? "rotate-180 lg:-rotate-90" : ""}`}
                    aria-hidden
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="px-5 pb-4 flex flex-col gap-2.5 lg:hidden">
                    {detailBody(c)}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {/* PC 우측 패널 */}
      {convs && convs.length > 0 && (
        <div className="hidden lg:flex flex-col gap-3 card p-5 lg:sticky lg:top-[76px]">
          {openConv ? (
            <>
              <div className="flex items-center gap-3 pb-3 border-b border-line">
                <span className="grid place-items-center w-10 h-10 shrink-0 rounded-full bg-blue text-white font-bold">
                  {avatarEmoji(openConv.teacher_name ?? "선생님")}
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-[16px] truncate">{openConv.title || "제목 없음"}</p>
                  <p className="text-sub text-[13px] truncate">{openConv.teacher_name ?? "선생님"}</p>
                </div>
              </div>
              {detailBody(openConv)}
            </>
          ) : (
            <p className="text-sub text-[14px] text-center py-16">왼쪽에서 대화를 고르면 내용이 여기에 나와요.</p>
          )}
        </div>
      )}
      </div>
    </main>
  );
}
