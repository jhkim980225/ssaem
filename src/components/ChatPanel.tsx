"use client";
import { useRef, useState, type ReactNode } from "react";
import { avatarEmoji } from "@/lib/avatar";

type Msg = { role: "user" | "tutor"; text: string };

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
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
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
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
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

  const emoji = avatarEmoji(teacherName);

  function scrollDown() {
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
  }

  async function send() {
    const question = q.trim();
    if (!question || loading || !teacherId) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    scrollDown();
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
      scrollDown();
    }
  }

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
            <div className="avatar !w-14 !h-14 !text-[26px]">{emoji}</div>
            <p className="text-sub text-[14px] text-center">
              {teacherName} 선생님에게
              <br />
              궁금한 걸 물어보세요.
            </p>
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
            <div key={i} className="bubble-in self-start flex items-end gap-2 max-w-[92%]">
              <div className="avatar !w-8 !h-8 !text-[15px] mb-1">{emoji}</div>
              <div className="md card !rounded-[20px] !rounded-bl-[6px] px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap min-w-0">
                {renderMd(m.text)}
              </div>
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

      <div className="flex gap-2 mt-3 pb-[env(safe-area-inset-bottom)]">
        <input
          className="field !rounded-full"
          placeholder="질문 입력"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합 중 Enter 중복 전송 방지
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
        />
        <button
          onClick={send}
          disabled={loading || !q.trim()}
          aria-label="전송"
          className="btn btn-primary !rounded-full w-[52px] h-[52px] shrink-0 grid place-items-center text-[20px]"
        >
          ↑
        </button>
      </div>
    </div>
  );
}
