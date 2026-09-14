import type { ReactNode } from "react";

/* ── 마크다운-lite: **굵게**, `코드`, 표, 불릿만. 라이브러리 없이. ──
   AI 답변을 보여주는 곳(질문 채팅·학생/강사 질문 이력)이 전부 이걸 쓴다.
   따로 원문을 찍으면 표가 `| a | b |` 기호째 노출된다. 스타일은 부모의 .md 클래스(globals.css). */
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

export function renderMd(text: string): ReactNode[] {
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
