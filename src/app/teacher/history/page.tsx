"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Conv = { id: string; title: string | null; created_at: string; messages: number };
type Msg = { id: string; role: "user" | "assistant"; content: string; created_at: string };

export default function HistoryPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({});

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    fetch("/api/conversations", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => setConvs(d.conversations ?? []))
      .catch(() => setConvs([]));
  }, [session]);

  async function toggle(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!msgs[id] && session) {
      const r = await fetch(`/api/conversations?id=${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await r.json();
      if (r.ok) setMsgs((m) => ({ ...m, [id]: d.messages ?? [] }));
    }
  }

  if (!ready)
    return (
      <main className="flex-1 grid place-items-center">
        <div className="skel w-12 h-12 !rounded-full" />
      </main>
    );

  if (!session)
    return (
      <main className="flex-1 grid place-items-center px-5">
        <div className="text-center">
          <p className="text-sub mb-4">로그인이 필요해요.</p>
          <Link href="/teacher" className="btn btn-primary py-3 px-6 inline-block">
            강사 로그인
          </Link>
        </div>
      </main>
    );

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise">
        <Link href="/teacher" className="text-sub text-[13px]">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">학생 질문 이력</h1>
        <p className="text-sub text-[14px]">학생들이 내 튜터에게 물어본 내용이에요.</p>
      </div>

      {convs === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-16 !rounded-[20px]" />
          ))}
        </div>
      )}

      {convs?.length === 0 && (
        <div className="rise d1 card p-10 text-center">
          <p className="text-[30px] mb-2">📭</p>
          <p className="text-sub text-[14px]">아직 질문이 없어요.</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {convs?.map((c, i) => (
          <div key={c.id} className={`rise d${Math.min(i + 1, 6)} card overflow-hidden`}>
            <button onClick={() => toggle(c.id)} className="w-full text-left p-4 lg:p-5 cursor-pointer">
              <div className="flex items-center justify-between gap-3">
                <p className="font-bold text-[15px] truncate">{c.title || "제목 없음"}</p>
                <span className="text-sub text-[12px] shrink-0">
                  메시지 {c.messages} ·{" "}
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
              <div className="px-4 lg:px-5 pb-4 flex flex-col gap-2 border-t border-line pt-3">
                {!msgs[c.id] && <div className="skel h-10" />}
                {msgs[c.id]?.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="self-end max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap bg-blue text-white rounded-[16px] rounded-br-[5px]">
                      {m.content}
                    </div>
                  ) : (
                    <div
                      key={m.id}
                      className="self-start max-w-[92%] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap rounded-[16px] rounded-bl-[5px] border border-line"
                      style={{ background: "var(--fill-2)" }}
                    >
                      {m.content}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
