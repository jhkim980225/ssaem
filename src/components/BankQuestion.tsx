"use client";

// 기출문제 본문·해설 공용 표현 컴포넌트 — 공부/한 문제씩(bank/page)과 CBT(CbtRunner)가 같이 쓴다.
// 데이터는 그대로 두고 줄 단위로 "표현 역할"만 나눈다.

// stem에서 첨부 서식([[서식]]) 분리 — 행 정렬이 생명이라 가로 스크롤 박스로
function splitStem(stem: string): { body: string; form: string | null } {
  const parts = stem.split("\n[[서식]]\n");
  return parts.length > 1 ? { body: parts[0], form: parts.slice(1).join("\n") } : { body: stem, form: null };
}

// "· 항목 : 값" 줄 → 라벨+값 블록(값 강조), "단, …" 줄 → 부가 조건 톤, 나머지 → 질문 본문.
const ITEM_RE = /^\s*[·•‧\-]\s*(.+?)\s*[:：]\s*(.+)$/;
const NOTE_RE = /^\s*[(（]?\s*단[,，]/;
// 파이프라인(hwp)이 직렬화한 표: [[표]]셀|셀∥셀|셀[[/표]] — 행 ∥, 셀 |
const TABLE_RE = /\[\[표\]\](.*?)\[\[\/표\]\]/;

function TableBlock({ data, highlight }: { data: string; highlight?: string }) {
  const rows = data.split("∥").map((r) => r.split("|"));
  return (
    <div className="overflow-x-auto mt-1">
      <table className="border-collapse text-[14px]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className="border border-line px-3 py-1.5 text-center whitespace-nowrap tabular-nums"
                  style={i === 0 ? { background: "var(--fill-2)", fontWeight: 700 } : undefined}
                >
                  <Hi text={c} kw={highlight} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 검색어 강조 — 문제검색에서 지문 속 키워드를 빨간색으로 표시
export function Hi({ text, kw }: { text: string; kw?: string }) {
  if (!kw || !text.includes(kw)) return <>{text}</>;
  const parts = text.split(kw);
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <mark className="font-extrabold" style={{ background: "transparent", color: "var(--red)" }}>
              {kw}
            </mark>
          )}
        </span>
      ))}
    </>
  );
}

export function StemView({ stem, images, highlight }: { stem: string; images?: string[] | null; highlight?: string }) {
  const { body, form } = splitStem(stem);
  return (
    <div className="flex flex-col gap-1.5 break-keep">
      {body.split("\n").map((line, i) => {
        const tm = line.match(TABLE_RE);
        if (tm)
          return (
            <div key={i} className="flex flex-col gap-1">
              {line.slice(0, tm.index).trim() && (
                <p className="text-[15px] leading-[1.7] whitespace-pre-wrap"><Hi text={line.slice(0, tm.index).trim()} kw={highlight} /></p>
              )}
              <TableBlock data={tm[1]} highlight={highlight} />
              {line.slice((tm.index ?? 0) + tm[0].length).trim() && (
                <p className="text-[15px] leading-[1.7] whitespace-pre-wrap">
                  <Hi text={line.slice((tm.index ?? 0) + tm[0].length).trim()} kw={highlight} />
                </p>
              )}
            </div>
          );
        const item = line.match(ITEM_RE);
        if (item)
          return (
            <div key={i} className="mt-1.5 pl-3 border-l-2" style={{ borderColor: "var(--line)" }}>
              <p className="text-[15px] font-medium leading-[1.65] whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                <Hi text={item[1]} kw={highlight} />
              </p>
              <p className="text-[16px] lg:text-[17px] font-bold tabular-nums mt-0.5">
                <Hi text={item[2]} kw={highlight} />
              </p>
            </div>
          );
        if (NOTE_RE.test(line))
          return (
            <p key={i} className="text-[15px] leading-[1.7] mt-1 whitespace-pre-wrap" style={{ color: "var(--sub-2)" }}>
              <Hi text={line} kw={highlight} />
            </p>
          );
        if (!line.trim()) return <div key={i} className="h-1" />;
        return (
          <p key={i} className="text-[17px] lg:text-[18px] font-semibold leading-[1.7] whitespace-pre-wrap">
            <Hi text={line} kw={highlight} />
          </p>
        );
      })}
      {form && (
        <pre
          className="text-[12px] leading-snug overflow-x-auto rounded-[12px] border border-line p-3 mt-1"
          style={{ background: "var(--fill-2)" }}
        >
          {form}
        </pre>
      )}
      {/* 그림 자료 (증빙 캡처 등) — PDF에서 잘라 온 문제 첨부 이미지 */}
      {(images ?? []).map((src) => (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage 외부 URL, 크기 미상이라 next/image 부적합
        <img
          key={src}
          src={src}
          alt="문제 그림 자료"
          className="max-w-full rounded-[12px] border border-line mt-1 self-start"
          style={{ background: "#fff" }}
        />
      ))}
    </div>
  );
}

// 해설 — "라벨 : 금액" 줄은 계산 근거 행(라벨 좌·금액 우)으로, 나머지는 문단으로.
export function ExplanationView({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 break-keep">
      {text.split("\n").map((line, i) => {
        const tm = line.match(TABLE_RE);
        if (tm) return <TableBlock key={i} data={tm[1]} />;
        const m = line.match(/^\s*[·•‧\-]?\s*(.+?)\s*[:：=]\s*([\d,]+\s*원?)\s*$/);
        if (m)
          return (
            <div key={i} className="flex items-baseline justify-between gap-3 py-0.5">
              <span className="text-[14px] leading-[1.7] min-w-0" style={{ color: "var(--text-2)" }}>
                {m[1]}
              </span>
              <span className="text-[15px] font-bold tabular-nums shrink-0">{m[2]}</span>
            </div>
          );
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className="text-[15px] leading-[1.75] whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
            {line}
          </p>
        );
      })}
    </div>
  );
}
