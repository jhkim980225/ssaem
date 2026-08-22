// 실무분개 정답 렌더.
// 소스 PDF의 분개표(차변|대변 2열)를 평문으로 받은 것이라, 첫 줄 이후 이어지는 계정 줄은
// 어느 열이었는지 정보가 없다. 그대로 왼쪽에 그리면 대변 항목이 차변처럼 보인다(예: 주식발행초과금).
// → 대차평형(차변 합 = 대변 합)으로 이어지는 항목의 열을 복원한다. 유일해가 없으면 원문 그대로.
//   ("초과금은 대변" 같은 계정 규칙 하드코딩은 오답 — 할인발행 상계면 초과금이 차변에 온다.)

type Pair = { name: string; amount: number };

// "계정 1,234원 계정2 5,678원" → 짝 목록. 금액 없는 꼬리가 남으면 실패(null).
function pairsOf(line: string): Pair[] | null {
  const out: Pair[] = [];
  let consumed = 0;
  for (const m of line.matchAll(/(.*?)(\d[\d,]*)원/g)) {
    const name = m[1].trim();
    if (!name) return null;
    out.push({ name, amount: Number(m[2].replace(/,/g, "")) });
    consumed = (m.index ?? 0) + m[0].length;
  }
  if (!out.length || line.slice(consumed).trim()) return null;
  return out;
}

const sum = (ps: Pair[]) => ps.reduce((s, p) => s + p.amount, 0);

// 이어지는 항목들을 차/대에 배치해 대차가 맞는 배치를 찾는다. 유일해만 채택.
function balance(cont: Pair[], chSum: number, dSum: number): boolean[] | null {
  if (cont.length > 12) return null;
  let found: number | null = null;
  for (let mask = 0; mask < 1 << cont.length; mask++) {
    let l = chSum;
    let r = dSum;
    for (let i = 0; i < cont.length; i++) {
      if ((mask >> i) & 1) r += cont[i].amount;
      else l += cont[i].amount;
    }
    if (l === r && l > 0) {
      if (found !== null && found !== mask) return null; // 복수 해 — 단정하지 않는다
      found = mask;
    }
  }
  if (found === null) return null;
  return cont.map((_, i) => Boolean((found! >> i) & 1)); // true = 대변
}

type Entry =
  | { kind: "text"; line: string }
  | { kind: "journal"; date: string | null; left: Pair[]; right: Pair[] };

// 전체 텍스트를 (일반 줄 | 복원된 분개표) 목록으로 파싱. 복원 불가면 null → 원문 렌더.
function parse(text: string): Entry[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Entry[] = [];
  let i = 0;
  let sawJournal = false;
  while (i < lines.length) {
    let line = lines[i];
    const dm = line.match(/^(\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?)\s*(.*)$/);
    const date = dm?.[1] ?? null;
    if (dm) line = dm[2];
    const ci = line.indexOf("(차)");
    const di = line.indexOf("(대)");
    if (ci === -1 || di === -1 || di < ci) {
      out.push({ kind: "text", line: lines[i] });
      i++;
      continue;
    }
    // 분개 시작 줄
    const left = pairsOf(line.slice(ci + 3, di));
    const right = pairsOf(line.slice(di + 3));
    if (!left || !right) return null;
    // 이어지는 계정 줄 수집 (다음 (차) 줄이나 일반 텍스트 전까지)
    const cont: Pair[] = [];
    i++;
    while (i < lines.length) {
      const nxt = lines[i];
      if (nxt.includes("(차)") || /^\d{4}\s*\./.test(nxt)) break;
      const ps = pairsOf(nxt);
      if (!ps) break; // 금액 없는 줄(비고 등) — 분개표 밖 텍스트로 처리
      cont.push(...ps);
      i++;
    }
    if (cont.length) {
      const side = balance(cont, sum(left), sum(right));
      if (!side) return null; // 복원 실패 — 전체를 원문 렌더로
      cont.forEach((p, k) => (side[k] ? right.push(p) : left.push(p)));
    }
    out.push({ kind: "journal", date, left, right });
    sawJournal = true;
  }
  return sawJournal ? out : null;
}

const won = (n: number) => n.toLocaleString("ko-KR") + "원";

export default function JournalEntry({ text }: { text: string }) {
  const parsed = parse(text);

  if (parsed)
    return (
      <div className="flex flex-col gap-1 text-[14px] leading-relaxed">
        {parsed.map((e, i) =>
          e.kind === "text" ? (
            <div key={i} className="whitespace-pre-wrap break-words">
              {e.line}
            </div>
          ) : (
            <div key={i}>
              {e.date && <div className="mb-0.5 text-[12px] font-semibold text-sub">{e.date}</div>}
              <div className="grid grid-cols-2">
                <div className="pr-3 flex flex-col gap-0.5">
                  {e.left.map((p, k) => (
                    <div key={k} className="break-words">
                      {k === 0 ? "(차) " : ""}
                      {p.name} {won(p.amount)}
                    </div>
                  ))}
                </div>
                {/* --line은 blue-weak 배경 위에서 대비가 0이라 안 보인다 → 중간톤으로 */}
                <div
                  className="pl-3 flex flex-col gap-0.5"
                  style={{ borderLeft: "1.5px solid color-mix(in srgb, var(--sub) 45%, transparent)" }}
                >
                  {e.right.map((p, k) => (
                    <div key={k} className="break-words">
                      {k === 0 ? "(대) " : ""}
                      {p.name} {won(p.amount)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        )}
      </div>
    );

  // 복원 실패 시 기존 렌더 — 줄 단위, (차)…(대)…만 2단
  return (
    <div className="flex flex-col gap-1 text-[14px] leading-relaxed">
      {text.split("\n").map((raw, i) => {
        let line = raw.trim();
        if (!line) return null;
        const dm = line.match(/^(\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?)\s*(.*)$/);
        const date = dm?.[1];
        if (dm) line = dm[2];
        const di = line.indexOf("(대)");
        const twoCol = line.includes("(차)") && di > 0;
        return (
          <div key={i}>
            {date && <div className="mb-0.5 text-[12px] font-semibold text-sub">{date}</div>}
            {twoCol ? (
              <div className="grid grid-cols-2">
                <div className="whitespace-pre-wrap break-words pr-3">{line.slice(0, di).trim()}</div>
                <div
                  className="whitespace-pre-wrap break-words pl-3"
                  style={{ borderLeft: "1.5px solid color-mix(in srgb, var(--sub) 45%, transparent)" }}
                >
                  {line.slice(di).trim()}
                </div>
              </div>
            ) : (
              line && <div className="whitespace-pre-wrap break-words">{line}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// 검증 스크립트(verify)용 — 컴포넌트 밖에서 파서만 돌려볼 수 있게
export { parse as parseJournalForTest };
