"use client";
import { useRef, useState } from "react";

type Msg = { role: "user" | "tutor"; text: string };

export default function ChatPanel({
  teacherId,
  teacherName,
  compact,
}: {
  teacherId: string;
  teacherName: string;
  compact?: boolean;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  async function send() {
    const question = q.trim();
    if (!question || loading || !teacherId) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId, question, conversationId }),
      });
      const d = await r.json();
      if (r.ok && d.conversationId) setConversationId(d.conversationId);
      setMsgs((m) => [...m, { role: "tutor", text: r.ok ? d.answer : `⚠️ ${d.error}` }]);
    } catch {
      setMsgs((m) => [...m, { role: "tutor", text: "⚠️ 요청 실패" }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
    }
  }

  return (
    <div className="flex flex-col">
      <div
        ref={scroller}
        className={`flex flex-col gap-3 overflow-y-auto ${compact ? "max-h-72" : "min-h-[40vh] max-h-[55vh]"} px-1 py-2`}
      >
        {msgs.length === 0 && (
          <p className="text-sub text-[14px] text-center py-8">
            {teacherName} 선생님에게 궁금한 걸 물어보세요.
          </p>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`animate-pop max-w-[85%] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "self-end bg-blue text-white rounded-[18px] rounded-br-[6px]"
                : "self-start card rounded-[18px] rounded-bl-[6px]"
            }`}
          >
            {m.text}
          </div>
        ))}
        {loading && (
          <div className="self-start card rounded-[18px] rounded-bl-[6px] px-4 py-3 flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-sub"
                style={{ animation: `dot 1.2s ${i * 0.2}s infinite ease-in-out` }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          className="field"
          placeholder="질문 입력"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={loading || !q.trim()} className="btn btn-primary px-5 shrink-0">
          전송
        </button>
      </div>
    </div>
  );
}
