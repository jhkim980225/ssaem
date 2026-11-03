// 한글(.hwp/.hwpx)·워드(.docx) 텍스트 추출. 학원 자료 대부분이 한글 파일이다.
// Workers(OpenNext)에서도 돌아야 해서 순수 JS + Uint8Array만 쓴다 — Buffer·zlib·fs 없음.
// fflate는 "fflate/browser"로 가져온다: 기본(node) 빌드는 module.createRequire·worker_threads를 끌어온다.
import { unzipSync, Inflate } from "fflate/browser";

/** 강사에게 그대로 보여줄 수 있는 실패 사유 */
export class ExtractError extends Error {}

export type FileKind = "pdf" | "docx" | "hwpx" | "hwp";

// 압축 해제 총량 상한 — 15MB 업로드가 수 GB로 부풀어 함수 메모리를 터뜨리지 않게
const MAX_INFLATED = 64 * 1024 * 1024;

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);
const ascii = (b: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...b.subarray(from, from + len));

/** 매직 바이트로 판별 — 확장자·MIME은 자기신고라 못 믿는다. 모르는 형식이면 null */
export function fileKind(buf: Uint8Array): FileKind | null {
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const names = zipNames(buf);
    if (names.includes("word/document.xml")) return "docx";
    if (names.some((n) => HWPX_SECTION.test(n))) return "hwpx";
    return null;
  }
  // OLE 복합문서(HWP 5.0, 옛 .doc도 여기) · HWP 3.0 — 구분과 안내는 extractHwp가 한다
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "hwp";
  if (ascii(buf, 0, 17) === "HWP Document File") return "hwp";
  return null;
}

/** 원문 텍스트. 읽을 수 없는 파일이면 ExtractError(강사용 문구) */
export function extractOfficeText(kind: Exclude<FileKind, "pdf">, buf: Uint8Array): string {
  try {
    const blocks = kind === "hwp" ? extractHwp(buf) : extractZipXml(kind, buf);
    return blocks
      // 사용자 정의 영역(한글·워드 전용 기호 글꼴)·제어문자 — 다른 데선 깨진 글자로 보인다
      .map((b) => b.replace(/[\ue000-\uf8ff\u0000-\u0008\u000b-\u001f]/g, "").replace(/[ \t\u00a0]+$/gm, "").trim())
      .filter(Boolean)
      // 빈 줄로 나눠야 chunkText가 문단 경계로 자른다 (한 줄 구분이면 통째 한 문단 → 하드컷)
      .join("\n\n");
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    console.error("extract:", kind, e instanceof Error ? e.message : e);
    throw new ExtractError("파일을 읽지 못했어요. 손상된 파일인지 확인하고 다시 저장해 올려 주세요.");
  }
}

// ── 표 → 줄 ─────────────────────────────────────────────────────────────
// rows[행][열] = 셀 안 문단들. 표는 "셀 | 셀" 한 행 한 줄로 — 셀을 줄줄이 흘리면 어느 값이
// 어느 항목인지 끊긴다. 1칸 표(테두리 박스)·보기(①~⑤) 조판 표는 표가 아니라 본문이라 문단으로 흘린다.
function tableLines(rows: string[][][]): string[] {
  const cells = rows.flat();
  if (cells.length <= 1 || cells.some((c) => c.some((l) => /^[①-⑤]/.test(l)))) return cells.flat();
  return rows
    .map((r) => r.map((c) => c.join(" ").replace(/\s*\n\s*/g, " ")).join(" | "))
    .filter((l) => /[^|\s]/.test(l));
}

// ── .docx / .hwpx (zip + XML) ─────────────────────────────────────────────
const HWPX_SECTION = /^Contents\/section(\d+)\.xml$/;

function zipNames(buf: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(buf, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    /* 깨진 zip — 모르는 형식으로 취급 */
  }
  return names;
}

function extractZipXml(kind: "docx" | "hwpx", buf: Uint8Array): string[] {
  let total = 0;
  const files = unzipSync(buf, {
    filter: (f) => {
      const want = kind === "docx" ? f.name === "word/document.xml" : HWPX_SECTION.test(f.name);
      if (want && (total += f.originalSize) > MAX_INFLATED)
        throw new ExtractError("파일 안 내용이 너무 커요. 나눠서 올려 주세요.");
      return want;
    },
  });
  const names = Object.keys(files).sort(
    (a, b) => Number(HWPX_SECTION.exec(a)?.[1] ?? 0) - Number(HWPX_SECTION.exec(b)?.[1] ?? 0)
  );
  if (!names.length) throw new ExtractError("문서 본문을 찾지 못했어요.");
  const dec = new TextDecoder("utf-8");
  return names.flatMap((n) => xmlBlocks(dec.decode(files[n])));
}

const XML_ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] !== "#") return XML_ENT[e] ?? m;
    const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

type Node =
  | { t: "p"; buf: string }
  | { t: "tbl"; rows: string[][][] }
  | { t: "tc"; lines: string[] };

// docx(w:)·hwpx(hp:) 공용 — 구조가 같다(p > run > t, tbl > tr > tc > p). 접두어는 무시하고 로컬명으로 본다.
// DOMParser가 Workers에 없어서 토큰 단위로 훑는다.
function xmlBlocks(xml: string): string[] {
  const out: string[] = [];
  const stack: Node[] = [];
  let tDepth = 0; // <t> 안의 글자만 본문
  let skip = 0; // 이 안은 통째로 무시 (아래 SKIP)
  const near = <K extends Node["t"]>(t: K) => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].t === t) return stack[i] as Extract<Node, { t: K }>;
    return null;
  };
  const emit = (line: string) => {
    const tc = near("tc");
    if (tc) tc.lines.push(line);
    else out.push(line);
  };
  const popTo = (t: Node["t"]) => {
    for (let i = stack.length - 1; i >= 0; i--)
      if (stack[i].t === t) return stack.splice(i)[0];
    return null;
  };
  const addText = (s: string) => {
    const p = near("p");
    if (p) p.buf += s;
  };

  for (const m of xml.matchAll(/<([^>]*)>|([^<]+)/g)) {
    if (m[2] !== undefined) {
      if (tDepth > 0 && !skip) addText(unescapeXml(m[2]));
      continue;
    }
    const tag = m[1];
    const close = tag[0] === "/";
    const self = tag.endsWith("/");
    const name = /^\/?(?:[\w.-]+:)?([\w.-]+)/.exec(tag)?.[1];
    if (!name) continue; // <?xml ?>, <!-- -->

    // pPr: 탭 '정의'(w:tabs/w:tab)가 있다. Fallback/default: 같은 내용의 대체본(텍스트 상자 중복). header/footer: 쪽마다 반복
    if (SKIP.has(name)) {
      if (!self) skip = Math.max(0, skip + (close ? -1 : 1));
      continue;
    }
    if (skip) continue;

    if (name === "t") {
      if (!self) tDepth += close ? -1 : 1;
    } else if (name === "p") {
      if (self) continue;
      if (!close) stack.push({ t: "p", buf: "" });
      else {
        const p = popTo("p") as { buf: string } | null;
        const text = p?.buf.trim();
        if (text) emit(text);
      }
    } else if (name === "tbl") {
      if (self) continue;
      if (!close) {
        // hwpx는 표가 문단 안에 들어 있다 — 표 앞 글자를 먼저 내보내야 순서가 맞다
        const p = near("p");
        if (p?.buf.trim()) {
          emit(p.buf.trim());
          p.buf = "";
        }
        stack.push({ t: "tbl", rows: [] });
      } else {
        const tbl = popTo("tbl") as { rows: string[][][] } | null;
        if (tbl) for (const l of tableLines(tbl.rows)) emit(l);
      }
    } else if (name === "tr") {
      if (!close && !self) near("tbl")?.rows.push([]);
    } else if (name === "tc") {
      if (self) continue;
      if (!close) stack.push({ t: "tc", lines: [] });
      else {
        const tc = popTo("tc") as { lines: string[] } | null;
        const tbl = near("tbl");
        if (tc && tbl) {
          if (!tbl.rows.length) tbl.rows.push([]);
          tbl.rows[tbl.rows.length - 1].push(tc.lines);
        }
      }
    } else if (!close) {
      if (name === "tab" || name === "ptab") addText("\t");
      else if (name === "br" || name === "cr" || name === "lineBreak") addText("\n");
      else if (name === "fwSpace" || name === "nbSpace") addText(" ");
    }
  }
  return out;
}
const SKIP = new Set(["pPr", "Fallback", "default", "header", "footer"]);

// ── .hwp (HWP 5.0 = OLE 복합문서 + 레코드) ───────────────────────────────
// 구조: FileHeader(서명·속성) + BodyText/Section{N}(레코드 열, 보통 raw deflate 압축).
// 표 셀 좌표 오프셋은 acct_quiz/pipeline/hwp_importer.py(실검증)와 같다.

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function extractHwp(buf: Uint8Array): string[] {
  if (ascii(buf, 0, 17) === "HWP Document File")
    throw new ExtractError("옛 한글(3.0) 파일이에요. 한글에서 '다른 이름으로 저장'(.hwp 또는 .hwpx)한 뒤 올려 주세요.");

  const cfb = readCfb(buf);
  const fh = cfb.read("FileHeader");
  if (!fh || ascii(fh, 0, 17) !== "HWP Document File") {
    if (cfb.has("WordDocument"))
      throw new ExtractError("옛 워드(.doc) 파일이에요. 워드에서 .docx로 저장한 뒤 올려 주세요.");
    throw new ExtractError("한글 파일이 아니거나 손상된 파일이에요.");
  }
  const props = u32(fh, 36);
  if (props & 0x2)
    throw new ExtractError("암호가 걸린 한글 문서예요. 한글에서 암호를 해제하고 저장한 뒤 올려 주세요.");
  // 배포용 문서는 본문이 ViewText에 암호화돼 있다
  if (props & 0x4)
    throw new ExtractError("배포용 한글 문서는 읽을 수 없어요. 한글에서 일반 문서(.hwp/.hwpx)로 저장한 뒤 올려 주세요.");
  const compressed = (props & 0x1) !== 0;

  const sections = cfb
    .paths()
    .map((p) => ({ p, n: /^BodyText\/Section(\d+)$/i.exec(p)?.[1] }))
    .filter((s) => s.n !== undefined)
    .sort((a, b) => Number(a.n) - Number(b.n));
  if (!sections.length) throw new ExtractError("한글 본문을 찾지 못했어요.");

  const budget = { left: MAX_INFLATED };
  const out: string[] = [];
  for (const { p } of sections) {
    const raw = cfb.read(p);
    if (!raw) continue;
    hwpSection(hwpRecords(compressed ? inflateRaw(raw, budget) : raw), out);
  }
  return out;
}

function inflateRaw(data: Uint8Array, budget: { left: number }): Uint8Array {
  const parts: Uint8Array[] = [];
  let n = 0;
  const inf = new Inflate((chunk) => {
    n += chunk.length;
    if ((budget.left -= chunk.length) < 0)
      throw new ExtractError("파일 안 내용이 너무 커요. 나눠서 올려 주세요.");
    parts.push(chunk);
  });
  inf.push(data, true);
  const res = new Uint8Array(n);
  let o = 0;
  for (const c of parts) {
    res.set(c, o);
    o += c.length;
  }
  return res;
}

const PARA_HEADER = 66;
const PARA_TEXT = 67;
const CTRL_HEADER = 71;
const LIST_HEADER = 72;
const TABLE = 77;
type Rec = { tag: number; level: number; data: Uint8Array };

function hwpRecords(dec: Uint8Array): Rec[] {
  const recs: Rec[] = [];
  let i = 0;
  while (i + 4 <= dec.length) {
    const h = u32(dec, i);
    i += 4;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (i + 4 > dec.length) break;
      size = u32(dec, i);
      i += 4;
    }
    recs.push({ tag: h & 0x3ff, level: (h >>> 10) & 0x3ff, data: dec.subarray(i, i + size) });
    i += size;
  }
  return recs;
}

// PARA_TEXT 안 제어문자: 이 코드들만 1글자, 나머지(0~31)는 8글자(16바이트)짜리 인라인/확장 컨트롤
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
function hwpText(d: Uint8Array): string {
  let s = "";
  const n = d.length >> 1;
  for (let j = 0; j < n; ) {
    const c = u16(d, j * 2);
    if (c < 32) {
      if (c === 9) s += "\t";
      else if (c === 10) s += "\n";
      else if (c === 24) s += "-";
      else if (c === 30 || c === 31) s += " ";
      j += CHAR_CTRL.has(c) ? 1 : 8;
      continue;
    }
    s += String.fromCharCode(c);
    j++;
  }
  return s;
}

const isTbl = (r: Rec) =>
  r.tag === CTRL_HEADER && r.data[0] === 0x20 && r.data[1] === 0x6c && r.data[2] === 0x62 && r.data[3] === 0x74; // " lbt" = 'tbl '

function hwpSection(recs: Rec[], out: string[]) {
  for (let i = 0; i < recs.length; ) {
    if (isTbl(recs[i])) {
      const [lines, next] = hwpTable(recs, i);
      out.push(...lines);
      i = next;
      continue;
    }
    if (recs[i].tag === PARA_TEXT) out.push(hwpText(recs[i].data));
    i++;
  }
}

/** recs[i](표 컨트롤)부터 표 하나를 소비해 [줄들, 다음 인덱스] */
function hwpTable(recs: Rec[], i: number): [string[], number] {
  const level = recs[i].level;
  const t = recs[i + 1];
  const rows = t?.tag === TABLE && t.data.length >= 8 ? u16(t.data, 4) : 0;
  const cols = t?.tag === TABLE && t.data.length >= 8 ? u16(t.data, 6) : 0;
  if (!(rows * cols > 0 && rows * cols <= 4096)) return [[], i + 1];

  const grid: string[][][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => []));
  let cur: string[] | null = null;
  let k = i + 2;
  while (k < recs.length) {
    const r = recs[k];
    if (r.level <= level && (r.tag === PARA_HEADER || r.tag === CTRL_HEADER)) break; // 표 밖
    if (isTbl(r)) {
      const [inner, nk] = hwpTable(recs, k);
      if (cur && inner.length) cur.push(...inner);
      k = nk;
      continue;
    }
    if (r.tag === LIST_HEADER && r.data.length >= 16) {
      const c = u16(r.data, 8);
      const rr = u16(r.data, 10);
      cur = rr < rows && c < cols ? grid[rr][c] : null;
    } else if (r.tag === PARA_TEXT && cur) {
      const txt = hwpText(r.data).replace(/\s*\n\s*/g, " ").trim();
      if (txt) cur.push(txt);
    }
    k++;
  }
  return [tableLines(grid), k];
}

// ── OLE 복합문서(CFB) 최소 리더 — 스트림 읽기만 ──────────────────────────
function readCfb(buf: Uint8Array) {
  const bad = () => new ExtractError("한글 파일이 아니거나 손상된 파일이에요.");
  if (buf.length < 512) throw bad();
  const secShift = u16(buf, 0x1e);
  if (secShift !== 9 && secShift !== 12) throw bad();
  const secSize = 1 << secShift;
  const miniSize = 1 << u16(buf, 0x20);
  const nFat = u32(buf, 0x2c);
  const cutoff = u32(buf, 0x38);
  const END = 0xfffffffa; // 이상은 특수값(ENDOFCHAIN·FREE 등)

  const sector = (s: number) => {
    const off = (s + 1) * secSize;
    if (off + secSize > buf.length) throw bad();
    return buf.subarray(off, off + secSize);
  };

  // FAT 섹터 목록: 헤더 DIFAT 109칸 + DIFAT 체인
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(buf, 0x4c + i * 4);
    if (s < END) fatSecs.push(s);
  }
  for (let d = u32(buf, 0x44), guard = 0; d < END && guard < 1 << 16; guard++) {
    const sec = sector(d);
    const per = secSize / 4 - 1;
    for (let j = 0; j < per; j++) {
      const s = u32(sec, j * 4);
      if (s < END) fatSecs.push(s);
    }
    d = u32(sec, per * 4);
  }
  fatSecs.length = Math.min(fatSecs.length, nFat);
  const fat = new Uint32Array(fatSecs.length * (secSize / 4));
  fatSecs.forEach((s, i) => {
    const sec = sector(s);
    for (let j = 0; j < secSize / 4; j++) fat[i * (secSize / 4) + j] = u32(sec, j * 4);
  });

  const chain = (start: number, table: Uint32Array) => {
    const out: number[] = [];
    for (let s = start; s < END; s = table[s] ?? END) {
      if (out.length > table.length) throw bad(); // 순환
      out.push(s);
    }
    return out;
  };
  const readBig = (start: number, size?: number) => {
    const secs = chain(start, fat);
    const res = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => res.set(sector(s), i * secSize));
    return size === undefined ? res : res.subarray(0, Math.min(size, res.length));
  };

  const dir = readBig(u32(buf, 0x30));
  type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(u16(dir, o + 64), 64);
    let name = "";
    for (let j = 0; j + 2 < nameLen; j += 2) name += String.fromCharCode(u16(dir, o + j));
    entries.push({
      name,
      type: dir[o + 66],
      left: u32(dir, o + 68),
      right: u32(dir, o + 72),
      child: u32(dir, o + 76),
      start: u32(dir, o + 116),
      size: u32(dir, o + 120),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw bad();

  const miniStream = readBig(root.start, root.size);
  const miniFatBytes = readBig(u32(buf, 0x3c));
  const miniFat = new Uint32Array(miniFatBytes.length / 4);
  for (let j = 0; j < miniFat.length; j++) miniFat[j] = u32(miniFatBytes, j * 4);

  // 디렉터리는 형제끼리 레드-블랙 트리(left/right), 하위는 child
  const byPath = new Map<string, Entry>();
  const seen = new Set<number>();
  const visit = (i: number, prefix: string) => {
    if (i >= entries.length || seen.has(i)) return;
    seen.add(i);
    const e = entries[i];
    visit(e.left, prefix);
    byPath.set(prefix + e.name, e);
    if (e.type === 1) visit(e.child, prefix + e.name + "/");
    visit(e.right, prefix);
  };
  visit(root.child, "");

  return {
    paths: () => [...byPath.keys()],
    has: (p: string) => byPath.has(p),
    read(p: string): Uint8Array | null {
      const e = byPath.get(p);
      if (!e || e.type !== 2) return null;
      if (e.size >= cutoff) return readBig(e.start, e.size);
      const secs = chain(e.start, miniFat);
      const res = new Uint8Array(secs.length * miniSize);
      secs.forEach((s, i) => {
        const off = s * miniSize;
        if (off + miniSize > miniStream.length) throw bad();
        res.set(miniStream.subarray(off, off + miniSize), i * miniSize);
      });
      return res.subarray(0, e.size);
    },
  };
}
