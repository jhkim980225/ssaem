"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { avatarEmoji } from "@/lib/avatar";

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
    if (openId === id) return setOpenId(null);
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
          <p className="text-[16px] font-bold mb-1">로그인이 필요해요</p>
          <p className="text-sub text-[14px] mb-5">대화내역은 계정에 저장돼요.</p>
          <Link href="/login?role=student" className="btn btn-primary py-3 px-6 inline-block">
            학생 로그인
          </Link>
        </div>
      </main>
    );

  const totalMsgs = (convs ?? []).reduce((s, c) => s + c.messages, 0);

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">내 대화내역</h1>
          <p className="text-sub text-[14px]">지금까지 선생님께 물어본 내용이에요.</p>
        </div>
        <Link href="/ask" className="chip shrink-0 !text-[13px]">
          질문하기
        </Link>
      </div>

      {convs === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-16 !rounded-[20px]" />
          ))}
        </div>
      )}

      {convs && convs.length > 0 && (
        <div className="rise d1 grid grid-cols-2 gap-2">
          {(
            [
              ["대화", convs.length],
              ["주고받은 글", totalMsgs],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="card p-4 text-center">
              <p className="text-[24px] font-extrabold tabular-nums">{n}</p>
              <p className="text-[12px] text-sub mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}

      {convs?.length === 0 && (
        <div className="rise d1 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 대화가 없어요</p>
          <p className="text-sub text-[13px] mb-5">선생님을 골라 첫 질문을 남겨보세요.</p>
          <Link href="/ask" className="btn btn-primary py-3 px-6 inline-block">
            질문하러 가기
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {convs?.map((c, i) => (
          <div key={c.id} className={`rise d${Math.min(i + 2, 6)} card overflow-hidden`}>
            <button onClick={() => toggle(c.id)} className="w-full text-left p-4 lg:p-5 cursor-pointer">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="avatar !w-8 !h-8 !text-[13px]">{avatarEmoji(c.teacher_name ?? "선생님")}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-[15px] truncate">{c.title || "제목 없음"}</p>
                    <p className="text-sub text-[12px] truncate">{c.teacher_name ?? "선생님"}</p>
                  </div>
                </div>
                <span className="text-sub text-[12px] shrink-0">
                  {c.messages}개 ·{" "}
                  {new Date(c.created_at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                </span>
              </div>
            </button>

            {openId === c.id && (
              <div className="px-4 lg:px-5 pb-4 flex flex-col gap-2 border-t border-line pt-3">
                {!msgs[c.id] && <div className="skel h-10" />}
                {msgs[c.id]?.map((m) =>
                  m.role === "user" ? (
                    <div
                      key={m.id}
                      className="self-end max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap bg-blue text-white rounded-[16px] rounded-br-[5px]"
                    >
                      {m.content}
                    </div>
                  ) : (
                    <div key={m.id} className="self-start max-w-[92%] flex flex-col gap-1">
                      <div
                        className="px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap rounded-[16px] rounded-bl-[5px] border border-line"
                        style={{ background: "var(--fill-2)" }}
                      >
                        {m.content}
                      </div>
                      {m.rating !== null && (
                        <span className="text-sub text-[12px] pl-1">
                          내 평가: {m.rating >= 4 ? "도움됐어요" : "아쉬워요"}
                        </span>
                      )}
                    </div>
                  )
                )}
                <Link
                  href={`/ask?teacher=${c.teacher_id}`}
                  className="btn btn-ghost py-2.5 text-[13px] text-center mt-1"
                >
                  이 선생님께 이어서 질문하기
                </Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
