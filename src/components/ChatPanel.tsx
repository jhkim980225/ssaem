"use client";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { avatarEmoji } from "@/lib/avatar";

export type Source = { kind: string; preview: string };
export type Msg = { role: "user" | "tutor"; text: string; sources?: Source[] };

/* ── 마크다운-lite: **굵게**, `코드`, 표, 불릿만. 라이브러리 없이. ── */
function inline(s: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={`${key}-${m.index}`}>{m[1]}</b>);
    else out.push(<code key={`${key}-${m.index}`}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

function renderMd(text: string): ReactNode[] {
  // 방어: 모델이 표 정렬용으로 뿜는 공백 폭주 제거
  const lines = text.replace(/ {3,}/g, " ").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 코드펜스 블록
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++; // 여는 펜스 스킵
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // 닫는 펜스 스킵 (스트리밍 중 미도착이면 그냥 끝까지)
      out.push(
        <pre key={`c${i}`}>
          <code>{buf.join("\n")}</code>
        </pre>
      );
      continue;
    }
    // 구분선
    if (/^\s*-{3,}\s*$/.test(line)) {
      out.push(<hr key={`h${i}`} />);
      i++;
      continue;
    }
    // 제목 → 굵은 줄
    if (/^#{1,4}\s+/.test(line)) {
      out.push(
        <b key={`hd${i}`} className="block mt-1">
          {inline(line.replace(/^#{1,4}\s+/, ""), i)}
        </b>
      );
      i++;
      continue;
    }
    // 표 블록
    if (/^\s*\|.+/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+/.test(lines[i])) {
        // 스트리밍 중 끝 | 가 아직 안 온 행도 허용
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); // 구분선 스킵
        i++;
      }
      out.push(
        <table key={`t${i}`}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) =>
                  ri === 0 ? <th key={ci}>{inline(c, ci)}</th> : <td key={ci}>{inline(c, ci)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }
    // 불릿 블록
    if (/^\s*[*-]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[*-]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[*-]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={`u${i}`}>
          {items.map((it, ii) => (
            <li key={ii}><span>{inline(it, ii)}</span></li>
          ))}
        </ul>
      );
      continue;
    }
    out.push(<span key={`l${i}`}>{inline(line, i)}{"\n"}</span>);
    i++;
  }
  return out;
}

// memo: 스트리밍 중 델타가 올 때마다 전체 목록이 리렌더되는데,
// 텍스트 안 바뀐 이전 말풍선은 renderMd 재파싱 스킵 (긴 대화에서 체감).
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
    <div className="bubble-in self-start flex items-end gap-2 max-w-[92%]">
      <div className="avatar !w-8 !h-8 !text-[15px] mb-1">{emoji}</div>
      <div className="md card !rounded-[20px] !rounded-bl-[6px] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap min-w-0">
        {renderMd(text)}
        {sources && sources.length > 0 && (
          <details className="mt-2 not-prose">
            <summary className="text-sub text-[12px] cursor-pointer select-none">
              출처 {sources.length}개
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {sources.map((s, i) => (
                <li key={i} className="text-sub text-[12px] leading-snug">
                  <span className="font-bold">
                    {s.kind === "style" ? "설명 스타일" : "문제/풀이"}
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
    <div className="flex flex-col h-full">
      <div
        ref={scroller}
        className={`flex flex-col gap-3 overflow-y-auto flex-1 ${
          compact ? "max-h-72" : "min-h-[40vh] max-h-[58vh] lg:max-h-none"
        } px-1 py-2`}
      >
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="avatar !w-14 !h-14 !text-[20px]">{emoji}</div>
            <p className="text-sub text-[14px] text-center">
              {teacherName} 선생님에게
              <br />
              궁금한 걸 물어보세요.
            </p>
            {/* 예시 질문 퀵칩 — 첫 질문 장벽 제거 (채널톡·Khanmigo 패턴) */}
            <div className="flex flex-wrap justify-center gap-2 mt-2 px-4">
              {["핵심 개념 쉽게 설명해줘", "연습 문제 하나 내줘", "자주 틀리는 포인트 알려줘"].map((s) => (
                <button key={s} onClick={() => send(s)} className="chip !text-[13px]">
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
              className="bubble-in self-end max-w-[85%] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap bg-blue text-white rounded-[20px] rounded-br-[6px]"
            >
              {m.text}
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-1">
              <TutorBubble text={m.text} emoji={emoji} sources={m.sources} />
              {/* 마지막 답변에만 피드백 (서버가 마지막 assistant 메시지에 기록) */}
              {i === lastTutorIdx && !loading && !streaming && m.text && !m.text.startsWith("⚠️") && conversationId && (
                <div className="self-start flex items-center gap-1 pl-11">
                  {rated === null ? (
                    <>
                      <button onClick={() => rate(5)} className="chip !px-2.5 !py-1 !text-[12px]">
                        도움됐어요
                      </button>
                      <button onClick={() => rate(1)} className="chip !px-2.5 !py-1 !text-[12px]">
                        아쉬워요
                      </button>
                    </>
                  ) : (
                    <span className="text-sub text-[12px]">평가 감사해요</span>
                  )}
                </div>
              )}
              {/* 유사 질문 추천 (클라썸 도트 패턴) — 마지막 답변에만 */}
              {i === lastTutorIdx && !loading && !streaming && related.length > 0 && (
                <div className="self-start flex flex-wrap items-center gap-1.5 pl-11 mt-1 animate-pop">
                  <span className="text-sub text-[12px]">이런 질문도 있어요:</span>
                  {related.map((rq) => (
                    <button key={rq} onClick={() => send(rq)} className="chip !py-1 !px-2.5 !text-[12px]">
                      {rq.length > 40 ? rq.slice(0, 40) + "…" : rq}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {loading && (
          <div className="bubble-in self-start flex items-end gap-2">
            <div className="avatar !w-8 !h-8 !text-[15px] mb-1">{emoji}</div>
            <div className="card !rounded-[20px] !rounded-bl-[6px] px-4 py-3.5 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-sub"
                  style={{ animation: `dot 1.2s ${i * 0.2}s infinite ease-in-out` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3 items-end pb-[env(safe-area-inset-bottom)]">
        <textarea
          className="field !rounded-[26px] resize-none leading-snug"
          placeholder="질문 입력 (Shift+Enter 줄바꿈)"
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
            className="btn !rounded-full w-[52px] h-[52px] shrink-0 grid place-items-center text-[18px] border border-line"
          >
            ■
          </button>
        ) : (
          <button
            onClick={() => send()}
            disabled={loading || !q.trim()}
            aria-label="전송"
            className="btn btn-primary !rounded-full w-[52px] h-[52px] shrink-0 grid place-items-center text-[20px]"
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}
