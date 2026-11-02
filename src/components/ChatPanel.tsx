"use client";
import { memo, useEffect, useRef, useState } from "react";
import { avatarEmoji } from "@/lib/avatar";
import { renderMd } from "@/components/Markdown";

export type Source = { kind: string; preview: string };
export type Msg = { role: "user" | "tutor"; text: string; sources?: Source[] };

// memo: 스트리밍 중 델타가 올 때마다 전체 목록이 리렌더되는데,
// 텍스트 안 바뀐 이전 말풍선은 renderMd 재파싱 스킵 (긴 대화에서 체감).
// 피드백·추천 줄은 부모가 pl-[42px](아바타 32 + 간격 10)로 이 열에 맞춘다.
const TutorBubble = memo(function TutorBubble({
  text,
  emoji,
  sources,
}: {
  text: string;
  emoji: string;
  sources?: Source[];
}) {
  return (
    <div className="bubble-in self-start flex items-start gap-2.5 max-w-[92%] lg:max-w-[80%]">
      <div className="avatar !w-8 !h-8 !text-[15px]">{emoji}</div>
      <div className="flex flex-col gap-2 min-w-0">
        <div
          className="md rounded-[14px] rounded-tl-[6px] border border-line px-4 py-3.5 text-[15px] leading-[1.65] whitespace-pre-wrap min-w-0"
          style={{ background: "var(--fill-2)" }}
        >
          {renderMd(text)}
        </div>
        {sources && sources.length > 0 && (
          <details className="group self-start max-w-full">
            <summary className="list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1.5 h-8 px-3 rounded-[8px] text-[13px] font-semibold cursor-pointer select-none" style={{ background: "var(--fill)", color: "var(--sub-2)" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                <path d="M14 3v5h5" />
              </svg>
              출처 {sources.length}개
            </summary>
            <ul className="mt-2 flex flex-col gap-1.5 rounded-[10px] border border-line px-3.5 py-3">
              {sources.map((s, i) => (
                <li key={i} className="text-[13px] leading-snug break-words" style={{ color: "var(--sub-2)" }}>
                  <span className="font-bold text-text">
                    {s.kind === "law" ? "현행 법령" : s.kind === "style" ? "설명 스타일" : "문제/풀이"}
                  </span>{" "}
                  · {s.preview}…
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
});

export default function ChatPanel({
  teacherId,
  teacherName,
  compact,
  token,
  courseId,
  initialConversationId,
  initialMsgs,
  autoAsk,
}: {
  teacherId: string;
  teacherName: string;
  compact?: boolean;
  token?: string; // 로그인 학생: 대화를 계정에 연결
  courseId?: string | null; // 강좌 필터 (공용 자료는 항상 포함)
  initialConversationId?: string | null; // 이전 대화 이어가기
  initialMsgs?: Msg[];
  autoAsk?: string; // 인기 질문 클릭 등으로 마운트 즉시 물어볼 질문
}) {
  const [msgs, setMsgs] = useState<Msg[]>(initialMsgs ?? []);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [rated, setRated] = useState<number | null>(null); // 마지막 답변에 준 평가 (5=도움됨, 1=아쉬움)
  const [related, setRelated] = useState<string[]>([]); // 유사 질문 추천 (답변 완료 후 로드)
  const [streaming, setStreaming] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoSent = useRef(false);

  const emoji = avatarEmoji(teacherName);

  // 인기 질문 클릭 진입 — 마운트 시 1회만 자동 전송 (키 변경으로 리마운트되면 다시 1회)
  useEffect(() => {
    if (!autoAsk || autoSent.current) return;
    autoSent.current = true;
    send(autoAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  function scrollDown() {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
  }

  async function send(preset?: string) {
    const question = (preset ?? q).trim();
    if (!question || loading || streaming || !teacherId) return;
    setQ("");
    setRelated([]);
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    scrollDown();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ teacherId, question, conversationId, courseId: courseId || null }),
        signal: ac.signal,
      });
      const convId = r.headers.get("X-Conversation-Id");
      if (convId) setConversationId(convId);
      setRated(null); // 새 답변 → 평가 초기화
      let sources: Source[] | undefined;
      try {
        const raw = r.headers.get("X-Sources");
        if (raw) sources = JSON.parse(decodeURIComponent(raw));
      } catch {}

      // 에러·체험모드는 JSON, 정상 답변은 텍스트 스트림
      if (r.headers.get("content-type")?.includes("application/json")) {
        const d = await r.json();
        if (r.ok && d.conversationId) setConversationId(d.conversationId);
        setMsgs((m) => [...m, { role: "tutor", text: r.ok ? d.answer : `⚠️ ${d.error}` }]);
      } else if (r.body) {
        setLoading(false);
        setStreaming(true);
        setMsgs((m) => [...m, { role: "tutor", text: "", sources }]);
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          setMsgs((m) => {
            const next = m.slice();
            const last = next[next.length - 1];
            next[next.length - 1] = { ...last, text: last.text + chunk };
            return next;
          });
          scrollDown();
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // 사용자가 중단 — 부분 답변은 그대로 두고 조용히 종료
      } else {
        setQ(question); // 실패한 질문 복원 → 바로 재전송 가능
        setMsgs((m) => [...m, { role: "tutor", text: "⚠️ 답변을 받지 못했어요 — 질문을 다시 보내주세요." }]);
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      setStreaming(false);
      scrollDown();
      // 유사 질문 추천 — 실패해도 무시 (추천은 있으면 좋은 것)
      fetch(`/api/related?teacher=${teacherId}&q=${encodeURIComponent(question)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => r.json())
        .then((d) => setRelated(d.related ?? []))
        .catch(() => {});
    }
  }

  async function rate(rating: number) {
    if (!conversationId || rated !== null) return;
    setRated(rating);
    try {
      // 로그인 학생 대화는 서버가 본인 확인 — 토큰 없으면 403이라 평가가 통째로 유실된다
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ conversationId, rating }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setRated(null); // 저장 안 됐는데 "평가 감사해요"를 띄우지 않는다 — 다시 누를 수 있게 되돌림
    }
  }

  const lastTutorIdx = msgs.map((m) => m.role).lastIndexOf("tutor");

  return (
    <div className="flex flex-col h-full flex-1">
      <div
        ref={scroller}
        className={`flex flex-col gap-4 overflow-y-auto flex-1 ${
          compact ? "max-h-72" : "min-h-[40vh] max-h-[58vh] lg:max-h-none"
        } px-1 py-3`}
      >
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="avatar !w-14 !h-14 !text-[20px]">{emoji}</div>
            <p className="text-sub text-[15px] text-center leading-relaxed">
              {teacherName} 선생님에게
              <br />
              궁금한 걸 물어보세요.
            </p>
            {/* 예시 질문 퀵칩 — 첫 질문 장벽 제거 (채널톡·Khanmigo 패턴) */}
            <div className="flex flex-wrap justify-center gap-1.5 mt-2 px-4">
              {["핵심 개념 쉽게 설명해줘", "연습 문제 하나 내줘", "자주 틀리는 포인트 알려줘"].map((s) => (
                <button key={s} onClick={() => send(s)} className="btn btn-ghost !rounded-[8px] h-9 px-3.5 text-[14px] !font-semibold">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              className="bubble-in self-end max-w-[78%] lg:max-w-[70%] px-4 py-3 text-[15px] leading-[1.55] whitespace-pre-wrap break-words bg-blue text-white rounded-[14px] rounded-br-[6px]"
            >
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2">
              <TutorBubble text={m.text} emoji={emoji} sources={m.sources} />
              {/* 마지막 답변에만 피드백 (서버가 마지막 assistant 메시지에 기록) */}
              {i === lastTutorIdx && !loading && !streaming && m.text && !m.text.startsWith("⚠️") && conversationId && (
                <div className="self-start flex items-center gap-2 pl-[42px]">
                  {rated === null ? (
                    <>
                      <button onClick={() => rate(5)} className="chip h-9 !py-0 !px-3.5 !text-[13px]">
                        도움됐어요
                      </button>
                      <button onClick={() => rate(1)} className="chip h-9 !py-0 !px-3.5 !text-[13px]">
                        아쉬워요
                      </button>
                    </>
                  ) : (
                    <span className="text-sub text-[13px]">평가 감사해요</span>
                  )}
                </div>
              )}
              {/* 유사 질문 추천 (클라썸 도트 패턴) — 마지막 답변에만 */}
              {i === lastTutorIdx && !loading && !streaming && related.length > 0 && (
                <div className="self-start flex flex-col items-start gap-1.5 pl-[42px] mt-1 max-w-full animate-pop">
                  <span className="text-sub text-[13px] mb-0.5">이런 질문도 있어요</span>
                  {related.map((rq) => (
                    <button
                      key={rq}
                      onClick={() => send(rq)}
                      className="btn btn-ghost !rounded-[8px] min-h-9 px-3.5 py-1.5 text-left text-[14px] !font-semibold max-w-full"
                    >
                      {rq.length > 40 ? rq.slice(0, 40) + "…" : rq}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {loading && (
          <div className="bubble-in self-start flex items-start gap-2.5">
            <div className="avatar !w-8 !h-8 !text-[15px]">{emoji}</div>
            <div
              role="status"
              aria-label="답변 작성 중"
              className="rounded-[14px] rounded-tl-[6px] border border-line px-4 py-4 flex gap-1.5"
              style={{ background: "var(--fill-2)" }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-2 h-2 rounded-full bg-sub"
                  style={{ animation: `dot 1.2s ${i * 0.2}s infinite ease-in-out` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-2 pt-3 border-t border-line items-end pb-[env(safe-area-inset-bottom)]">
        <textarea
          aria-label="질문 입력"
          className="field !rounded-[16px] !py-3 !px-[18px] !text-[16px] min-h-12 resize-none leading-snug disabled:opacity-60"
          // 답변 생성 중엔 send()가 조용히 return한다 — 입력은 되는데 Enter가 무반응이면
          // 사용자는 앱이 멈춘 줄 안다. 막을 거면 막혔다고 보이게 한다.
          disabled={loading || streaming}
          placeholder={
            loading || streaming ? "답변 중이에요. 끝나면 이어서 물어보세요" : "질문 입력 (Shift+Enter 줄바꿈)"
          }
          rows={Math.min(4, Math.max(1, q.split("\n").length))}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Enter 전송, Shift+Enter 줄바꿈. 한글 IME 조합 중 Enter 중복 전송 방지
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {streaming ? (
          <button
            onClick={() => abortRef.current?.abort()}
            aria-label="답변 중단"
            className="btn btn-primary !rounded-full w-12 h-12 shrink-0 grid place-items-center"
          >
            <span className="w-3.5 h-3.5 rounded-[3px] bg-white" aria-hidden />
          </button>
        ) : (
          <button
            onClick={() => send()}
            disabled={loading || !q.trim()}
            aria-label="전송"
            className="btn btn-primary !rounded-full w-12 h-12 shrink-0 grid place-items-center"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
