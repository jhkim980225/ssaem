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

// 항목 표지 — ㆍ·• 또는 a. / 가. 시험지에서 나란히 놓인 자료 나열이 표로 직렬화되면서
// 한 셀에 항목 여러 개가 뭉친다("ㆍ총매출액：1,000,000원 ㆍ매출에누리액：16,000원|ㆍ…"). 표지 앞에서 끊어 되돌린다.
const KO_MARKS = "가나다라마바사아자차카타파하";
const LETTER_START = new RegExp(`^(?:[a-z]|[${KO_MARKS}])\\.\\s`);
const MARK_START = new RegExp(`^(?:[ㆍ·•‧]|(?:[a-z]|[${KO_MARKS}])\\.\\s)`);
const MARK_SPLIT = new RegExp(`\\s+(?=[ㆍ·•‧]|(?:[a-z]|[${KO_MARKS}])\\.\\s)`);

function splitItems(cell: string): string[] {
  return cell
    .split(MARK_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean);
}

const isItemList = (items: string[]) => items.length > 1 && items.every((it) => MARK_START.test(it));

// a./가. 표지 순번 — 행 단위로 직렬화된 2단 목록(a d | b e | c)을 원래 순서로 되돌릴 때 쓴다
const markRank = (s: string) => (KO_MARKS.includes(s[0]) ? KO_MARKS.indexOf(s[0]) : s.charCodeAt(0) - 97);

// 표 칸 안에 항목이 여러 개면 한 줄에 하나씩 — 한 줄로 이어 붙이면 칸이 끝없이 넓어진다
function CellText({ text, highlight }: { text: string; highlight?: string }) {
  const items = splitItems(text);
  if (!isItemList(items)) return <Hi text={text} kw={highlight} />;
  return (
    <>
      {items.map((it, k) => (
        <div key={k} className="text-left">
          <Hi text={it} kw={highlight} />
        </div>
      ))}
    </>
  );
}

function TableBlock({ data, highlight }: { data: string; highlight?: string }) {
  const rows = data.split("∥").map((r) => r.split("|"));

  // 칸마다 표지 붙은 항목만 있는 표는 격자가 아니라 시험지의 자료 나열(나란히 배치)이다. 표로 그리면 칸이 옆으로만
  // 늘어나 가로 스크롤이 생긴다(예: 전산회계1급 101회 부가세 과세표준 자료) — 몇 줄짜리든 아래로 줄바꿈되는 블록으로 편다.
  const cells = rows.flat().map((c) => c.trim()).filter(Boolean);
  if (!cells.length) return null;
  const items = cells.flatMap(splitItems);
  const box = { background: "var(--fill-2)" };
  if (isItemList(items)) {
    const ranks = items.map(markRank);
    const ordered =
      items.every((it) => LETTER_START.test(it)) && new Set(ranks).size === ranks.length
        ? items.map((it, i) => ({ it, r: ranks[i] })).sort((a, b) => a.r - b.r).map((x) => x.it)
        : items;
    return (
      // PC는 시험지처럼 2단(열 우선으로 채워 원래 읽는 순서 유지), 좁은 화면은 한 줄에 하나
      <div className="mt-1 rounded-[12px] border border-line px-4 py-3 sm:columns-2 sm:gap-x-8" style={box}>
        {ordered.map((it, i) => (
          <p key={i} className="text-[15px] leading-[1.7] tabular-nums break-keep break-inside-avoid">
            <Hi text={it} kw={highlight} />
          </p>
        ))}
      </div>
    );
  }

  if (rows.length === 1) {
    // 표지 없는 한 줄(분개 한 줄·절차 나열 등)도 격자가 아니다 — 칸 단위로 이어 쓰고 넘치면 줄바꿈
    return (
      <div className="mt-1 rounded-[12px] border border-line px-4 py-2.5 flex flex-wrap gap-x-5 gap-y-1" style={box}>
        {cells.map((c, i) => (
          <span key={i} className="text-[15px] leading-[1.7] tabular-nums break-keep">
            <Hi text={c} kw={highlight} />
          </span>
        ))}
      </div>
    );
  }

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
                  <CellText text={c} highlight={highlight} />
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

// 보기 한 개. T계정처럼 보기 자체가 표인 문제가 있어 지문과 같은 표 렌더를 태운다
// (안 그러면 "[[표]]선수금|∥|150,000원[[/표]]" 원문이 그대로 노출된다).
export function ChoiceView({ text, highlight }: { text: string; highlight?: string }) {
  const tm = text.match(TABLE_RE);
  if (!tm) return <Hi text={text} kw={highlight} />;
  const before = text.slice(0, tm.index).trim();
  const after = text.slice((tm.index ?? 0) + tm[0].length).trim();
  return (
    <span className="flex flex-col gap-1 min-w-0">
      {before && <Hi text={before} kw={highlight} />}
      <TableBlock data={tm[1]} highlight={highlight} />
      {after && <Hi text={after} kw={highlight} />}
    </span>
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
            <div key={i} className="mt-1.5 pl-3 border-l-2" style={{ borderColor: "var(--border)" }}>
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
        if (tm) {
          // 표 앞뒤에 이어 붙은 풀이("… [[/표]] (2) 완성품 환산량")가 있다 — 표만 그리면 그 글이 통째로 사라진다
          const before = line.slice(0, tm.index).trim();
          const after = line.slice((tm.index ?? 0) + tm[0].length).trim();
          return (
            <div key={i} className="flex flex-col gap-1">
              {before && (
                <p className="text-[15px] leading-[1.75] whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                  {before}
                </p>
              )}
              <TableBlock data={tm[1]} />
              {after && (
                <p className="text-[15px] leading-[1.75] whitespace-pre-wrap" style={{ color: "var(--text-2)" }}>
                  {after}
                </p>
              )}
            </div>
          );
        }
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
