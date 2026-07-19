// 문서 청킹. 문단 단위로 묶되 목표 크기 초과 시 하드 분할. 청크간 overlap로 문맥 유지.
// 한국어 기준 char 길이 사용(토큰≈char로 근사).

export type ChunkOpts = { size?: number; overlap?: number };

export function chunkText(text: string, opts: ChunkOpts = {}): string[] {
  const size = opts.size ?? 800;
  const overlap = opts.overlap ?? 150;
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  // 문단 → 필요시 문장 → 필요시 하드컷 으로 최대 size 조각 만들기
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= size) pieces.push(p);
    else pieces.push(...splitLong(p, size));
  }

  // 조각을 size 안에서 그리디 병합
  const chunks: string[] = [];
  let cur = "";
  for (const piece of pieces) {
    if (!cur) cur = piece;
    else if (cur.length + 1 + piece.length <= size) cur += "\n" + piece;
    else {
      chunks.push(cur);
      cur = piece;
    }
  }
  if (cur) chunks.push(cur);

  // overlap 적용: 앞 청크 꼬리를 다음 청크 머리에 덧붙임
  if (overlap > 0 && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].slice(-overlap);
      chunks[i] = tail + "\n" + chunks[i];
    }
  }
  return chunks;
}

// 문장(마침표/줄바꿈) 경계 우선, 안 되면 강제 char 컷
function splitLong(p: string, size: number): string[] {
  const sentences = p.split(/(?<=[.!?。\n])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const seg = s.length > size ? hardCut(s, size) : [s];
    for (const part of seg) {
      if (!cur) cur = part;
      else if (cur.length + 1 + part.length <= size) cur += " " + part;
      else {
        out.push(cur);
        cur = part;
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}

function hardCut(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
