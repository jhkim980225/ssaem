// 엑셀 연습장 수식 엔진 — 컴활2급 필기 2과목(스프레드시트 일반)에서 다루는 함수·연산 위주.
//
// 외부 라이브러리를 안 쓴 이유: HyperFormula는 GPL(상용 서비스엔 유료 라이선스),
// fast-formula-parser는 D함수(DSUM·DAVERAGE…)가 없다 — 둘 다 컴활 2과목 단골이다.
//
// 구조: 토큰화 → 재귀 하강 파서(AST) → 평가. 셀 값은 읽을 때마다 계산(시트 단위 메모 + 순환 검출).
// 연습장은 수백 칸이라 의존성 그래프 없이 입력마다 새 Sheet를 만들어도 충분히 빠르다.
//
// 엑셀과 맞춘 규칙 (시험에 나오는 것들):
//  - 연산자 우선순위: 음수(-) > % > ^ > * / > + - > & > 비교. 그래서 =-2^2 는 4
//  - 빈 칸은 숫자 자리에선 0, 문자 자리에선 "". SUM 같은 집계는 범위 안의 문자·논리값을 건너뛴다
//  - 날짜 = 1900-01-01이 1인 일련번호 (엑셀의 1900년 윤년 버그까지 — 1900-02-29가 60)
//  - COUNTIF 계열 조건 ">=80", "<>", "김*"(와일드카드). D함수·고급 필터 조건의 글자는 "앞글자 일치"
//  - ROUND는 0.5에서 0과 먼 쪽으로, INT는 내림(음수면 더 작은 쪽), MOD는 나누는 수의 부호를 따른다

export type ErrCode = "#DIV/0!" | "#N/A" | "#NAME?" | "#NUM!" | "#REF!" | "#VALUE!" | "#CIRC!";

export class XErr {
  constructor(
    readonly code: ErrCode,
    readonly msg?: string
  ) {}
}

export type Scalar = number | string | boolean | null | XErr; // null = 빈 칸
type Arr = Scalar[][]; // 범위·배열 (행 우선)
type Val = Scalar | Arr;
export type Fmt = "date" | "time" | "datetime" | "percent" | "comma" | null;

export const MAX_COL = 26; // A~Z
export const MAX_ROW = 200;

const isArr = (v: Val): v is Arr => Array.isArray(v);
const isErr = (v: unknown): v is XErr => v instanceof XErr;

// ─────────────────────────────────────────────
// 주소
// ─────────────────────────────────────────────
export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function colIndex(s: string): number {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export const addr = (r: number, c: number) => `${colName(c)}${r + 1}`;
export function parseAddr(a: string): { r: number; c: number } | null {
  const m = a.match(/^\$?([A-Za-z]{1,3})\$?(\d+)$/);
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null;
}

// ─────────────────────────────────────────────
// 날짜 — 엑셀 1900 체계
// ─────────────────────────────────────────────
const DAY = 86400000;
const BASE = Date.UTC(1899, 11, 30);
export function toSerial(y: number, m: number, d: number): number {
  if (y === 1900 && m === 2 && d === 29) return 60; // 엑셀에만 있는 날
  const s = Math.round((Date.UTC(y, m - 1, d) - BASE) / DAY);
  return s < 61 ? s - 1 : s; // 1900-03-01 전은 하루 당김 (엑셀이 1900-02-29를 60으로 끼워 넣었다)
}
export function fromSerial(n: number): { y: number; m: number; d: number; wd: number } {
  const whole = Math.floor(n);
  // 요일은 일련번호로 센다 — 엑셀은 1900-01-01(1)을 일요일로 본다(실제론 월요일). 0 = 토요일
  const wd = (((whole % 7) + 7) % 7 + 6) % 7;
  if (whole === 0) return { y: 1900, m: 1, d: 0, wd }; // 엑셀의 "1900-01-00"
  if (whole === 60) return { y: 1900, m: 2, d: 29, wd };
  const t = new Date(BASE + (whole < 60 ? whole + 1 : whole) * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd };
}
function todaySerial(): number {
  const t = new Date();
  return toSerial(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

// ─────────────────────────────────────────────
// 입력값 해석 (수식이 아닌 칸) — "1,000" "50%" "2020-07-04" "10:30" "TRUE" "'0123"
// ─────────────────────────────────────────────
export function parseLiteral(raw: string): { v: Scalar; f: Fmt } {
  if (raw === "") return { v: null, f: null };
  if (raw.startsWith("'")) return { v: raw.slice(1), f: null };
  const t = raw.trim();
  // "1,000"처럼 쉼표를 넣어 치면 엑셀은 #,##0 서식을 같이 건다
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { v: Number(t.replace(/,/g, "")), f: "comma" };
  if (/^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t) || /^[+-]?\.\d+$/.test(t)) return { v: Number(t), f: null };
  let m = t.match(/^([+-]?\d+(?:\.\d+)?)%$/);
  if (m) return { v: Number(m[1]) / 100, f: "percent" };
  m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?$/) ?? t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31)
    return { v: toSerial(+m[1], +m[2], +m[3]), f: "date" };
  m = t.match(/^(\d{1,2})[-/](\d{1,2})$/) ?? t.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
  if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31)
    return { v: toSerial(new Date().getFullYear(), +m[1], +m[2]), f: "date" };
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m && +m[2] < 60 && +(m[3] ?? 0) < 60) return { v: (+m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400, f: "time" };
  if (/^true$/i.test(t)) return { v: true, f: null };
  if (/^false$/i.test(t)) return { v: false, f: null };
  return { v: raw, f: null };
}

// ─────────────────────────────────────────────
// 토큰화
// ─────────────────────────────────────────────
type Tok =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "err"; v: ErrCode }
  | { k: "id"; v: string } // 셀 주소·함수 이름·TRUE/FALSE·열 이름
  | { k: "op"; v: string };

export class FormulaError extends Error {}

const NO_ARGS = new Set(["TODAY", "NOW", "PI", "RAND", "NA", "TRUE", "FALSE"]);

const ERR_LITERALS: ErrCode[] = ["#DIV/0!", "#N/A", "#NAME?", "#NUM!", "#REF!", "#VALUE!"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new FormulaError("큰따옴표(\")가 닫히지 않았어요.");
        if (src[i] === '"') {
          if (src[i + 1] === '"') {
            s += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++];
      }
      out.push({ k: "str", v: s });
      continue;
    }
    // 따옴표 대신 엑셀에서 안 받는 “ ” ‘ ’ — 시험지·워드에서 복사해 오면 흔히 섞인다
    if ("“”‘’".includes(ch))
      throw new FormulaError("둥근 따옴표(“ ”)가 들어 있어요. 키보드의 곧은 따옴표(\")로 바꿔 주세요.");
    if (ch === "#") {
      const e = ERR_LITERALS.find((x) => src.startsWith(x, i));
      if (!e) throw new FormulaError(`'${src.slice(i, i + 6)}'을(를) 이해하지 못했어요.`);
      out.push({ k: "err", v: e });
      i += e.length;
      continue;
    }
    const num = src.slice(i).match(/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?/);
    if (num) {
      const rest = src.slice(i + num[0].length);
      if (rest.startsWith(":")) throw new FormulaError("행 전체 참조(예: 1:1)는 연습장에서 지원하지 않아요.");
      if (/^[A-Za-z_$]/.test(rest)) throw new FormulaError(`'${num[0]}${rest.match(/^[A-Za-z_$]+/)![0]}' 자리가 이상해요.`);
      out.push({ k: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    // 한글 이름(이름 정의 "범위1", "점수")도 이름으로 읽는다 — 평가에서 "이름 정의 미지원"으로 안내
    const id = src.slice(i).match(/^[A-Za-z_$가-힣][A-Za-z0-9_.$가-힣]*/);
    if (id) {
      out.push({ k: "id", v: id[0] });
      i += id[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "<>"].includes(two)) {
      out.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%(),:;{}".includes(ch)) {
      out.push({ k: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "!") throw new FormulaError("다른 시트 참조(Sheet1!A1)는 연습장에서 지원하지 않아요.");
    throw new FormulaError(`'${ch}' 기호는 수식에 쓸 수 없어요.`);
  }
  return out;
}

// ─────────────────────────────────────────────
// 파서
// ─────────────────────────────────────────────
type Node =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: ErrCode }
  | { t: "ref"; r: number; c: number }
  | { t: "range"; r0: number; c0: number; r1: number; c1: number }
  | { t: "call"; name: string; args: Node[] }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "neg"; a: Node }
  | { t: "pct"; a: Node }
  | { t: "arr"; rows: Scalar[][] }
  | { t: "name"; v: string };

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && (peek() as { v: string }).v === v;
  const expect = (v: string, msg: string) => {
    if (!isOp(v)) throw new FormulaError(msg);
    p++;
  };

  function comparison(): Node {
    let a = concat();
    while (peek()?.k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes((peek() as { v: string }).v)) {
      const op = (toks[p++] as { v: string }).v;
      a = { t: "bin", op, a, b: concat() };
    }
    return a;
  }
  function concat(): Node {
    let a = additive();
    while (isOp("&")) {
      p++;
      a = { t: "bin", op: "&", a, b: additive() };
    }
    return a;
  }
  function additive(): Node {
    let a = mult();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { t: "bin", op, a, b: mult() };
    }
    return a;
  }
  function mult(): Node {
    let a = power();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      a = { t: "bin", op, a, b: power() };
    }
    return a;
  }
  function power(): Node {
    let a = percent();
    while (isOp("^")) {
      p++;
      a = { t: "bin", op: "^", a, b: percent() };
    }
    return a;
  }
  function percent(): Node {
    let a = unary();
    while (isOp("%")) {
      p++;
      a = { t: "pct", a };
    }
    return a;
  }
  function unary(): Node {
    if (isOp("-")) {
      p++;
      return { t: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return primary();
  }
  function cellOrCol(v: string): { r: number | null; c: number } | null {
    const a = parseAddr(v);
    if (a) return a;
    const m = v.match(/^\$?([A-Za-z]{1,3})$/);
    return m ? { r: null, c: colIndex(m[1]) } : null;
  }
  function primary(): Node {
    const tk = toks[p];
    if (!tk) throw new FormulaError("수식이 덜 끝났어요.");
    if (tk.k === "num") {
      p++;
      return { t: "num", v: tk.v };
    }
    if (tk.k === "str") {
      p++;
      return { t: "str", v: tk.v };
    }
    if (tk.k === "err") {
      p++;
      return { t: "err", v: tk.v };
    }
    if (tk.k === "op" && tk.v === "(") {
      p++;
      const e = comparison();
      expect(")", "괄호가 닫히지 않았어요.");
      return e;
    }
    if (tk.k === "op" && tk.v === "{") {
      p++;
      const rows: Scalar[][] = [[]];
      for (;;) {
        let sign = 1;
        if (isOp("-")) {
          sign = -1;
          p++;
        }
        const x = toks[p++];
        if (!x) throw new FormulaError("배열 상수 { }가 닫히지 않았어요.");
        if (x.k === "num") rows[rows.length - 1].push(sign * x.v);
        else if (x.k === "str") rows[rows.length - 1].push(x.v);
        else if (x.k === "id" && /^(true|false)$/i.test(x.v)) rows[rows.length - 1].push(/^true$/i.test(x.v));
        else throw new FormulaError("배열 상수에는 숫자·글자·TRUE/FALSE만 넣을 수 있어요.");
        if (isOp(",")) p++;
        else if (isOp(";")) {
          p++;
          rows.push([]);
        } else {
          expect("}", "배열 상수 { }가 닫히지 않았어요.");
          break;
        }
      }
      return { t: "arr", rows };
    }
    if (tk.k === "id") {
      p++;
      // 함수 호출
      if (isOp("(")) {
        p++;
        const name = tk.v.toUpperCase().replace(/^_XLFN\./, "");
        const args: Node[] = [];
        if (!isOp(")")) {
          for (;;) {
            // 빈 인수 =IF(A1,,1) — 엑셀은 0/빈 값으로 본다
            if (isOp(",") || isOp(")")) args.push({ t: "arr", rows: [[null]] });
            else args.push(comparison());
            if (isOp(",")) {
              p++;
              continue;
            }
            break;
          }
        }
        expect(")", `${name} 함수의 괄호가 닫히지 않았어요.`);
        // 인수가 없는 함수에 인수를 넣으면 엑셀은 입력 자체를 받지 않는다 (=TODAY(B19) 같은 오답 보기)
        if (NO_ARGS.has(name) && args.length) throw new FormulaError(`${name} 함수에는 인수를 넣지 않아요 — ${name}() 처럼 써요.`);
        return { t: "call", name, args };
      }
      const a = cellOrCol(tk.v);
      if (a && isOp(":")) {
        p++;
        const nx = toks[p++];
        const b = nx && nx.k === "id" ? cellOrCol(nx.v) : null;
        if (!b || (a.r === null) !== (b.r === null)) throw new FormulaError("범위 주소가 잘못됐어요 (예: A1:B5).");
        const [ra, rb] = a.r === null ? [0, MAX_ROW - 1] : [a.r, b.r as number];
        return {
          t: "range",
          r0: Math.min(ra, rb),
          r1: Math.max(ra, rb),
          c0: Math.min(a.c, b.c),
          c1: Math.max(a.c, b.c),
        };
      }
      if (a && a.r !== null) {
        if (a.c >= MAX_COL || a.r >= MAX_ROW) return { t: "err", v: "#REF!" };
        return { t: "ref", r: a.r, c: a.c };
      }
      if (/^true$/i.test(tk.v)) return { t: "bool", v: true };
      if (/^false$/i.test(tk.v)) return { t: "bool", v: false };
      return { t: "name", v: tk.v };
    }
    throw new FormulaError(`'${(tk as { v: string }).v}' 자리가 이상해요.`);
  }

  const node = comparison();
  if (p < toks.length) {
    const tk = toks[p] as { v: unknown };
    throw new FormulaError(tk.v === ")" ? "닫는 괄호가 더 많아요." : `'${String(tk.v)}' 앞에서 수식이 끊겼어요 (쉼표·연산자 확인).`);
  }
  return node;
}

// ─────────────────────────────────────────────
// 값 변환
// ─────────────────────────────────────────────
function first(v: Val): Scalar {
  if (!isArr(v)) return v;
  if (v.length === 1 && v[0].length === 1) return v[0][0];
  return new XErr("#VALUE!", "여러 칸 범위를 값 하나가 들어갈 자리에 넣었어요.");
}
function toNum(v: Val): number | XErr {
  const s = first(v);
  if (s === null) return 0;
  if (typeof s === "number") return s;
  if (typeof s === "boolean") return s ? 1 : 0;
  if (isErr(s)) return s;
  const lit = parseLiteral(s);
  if (typeof lit.v === "number") return lit.v;
  return new XErr("#VALUE!", `글자 "${s}"를 숫자로 계산할 수 없어요.`);
}
function toStr(v: Val): string | XErr {
  const s = first(v);
  if (s === null) return "";
  if (typeof s === "string") return s;
  if (typeof s === "boolean") return s ? "TRUE" : "FALSE";
  if (isErr(s)) return s;
  return textOf(s);
}

// 숫자 → 글자 (LEFT·LEN·& 등) — 칸 표시("일반", 11자)가 아니라 유효숫자 15자리 그대로.
// 표시용 general()을 쓰면 주민번호 9001011234567이 "9.00101E+12"가 되어 LEFT·LEN이 틀린다
export function textOf(n: number): string {
  if (!isFinite(n)) return "#NUM!";
  if (Object.is(n, -0)) n = 0;
  const v = Number(n.toPrecision(15));
  return Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-9) ? expo(v) : String(v).includes("e") ? expo(v) : String(v);
}
const withCommas = (s: string) => (s.includes("E") ? s : s.replace(/^(-?\d+)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ",")));
const expo = (n: number) =>
  n
    .toExponential(5)
    .replace(/\.?0+e/, "e")
    .replace("e", "E")
    .replace(/E([+-])(\d)$/, "E$10$2");
function toBool(v: Val): boolean | XErr {
  const s = first(v);
  if (s === null) return false;
  if (typeof s === "boolean") return s;
  if (typeof s === "number") return s !== 0;
  if (isErr(s)) return s;
  if (/^true$/i.test(s)) return true;
  if (/^false$/i.test(s)) return false;
  return new XErr("#VALUE!", `글자 "${s}"는 참/거짓으로 볼 수 없어요.`);
}
const flat = (v: Val): Scalar[] => (isArr(v) ? v.flat() : [v]);

// 셀 표시 형식 "일반" — 기본 열 너비에 들어가는 11자 안에서 소수 자릿수를 줄인다
// (1/3 → 0.333333333). 11자리 넘는 큰 수·0.000001 미만은 지수 표기(1.23457E+11, 5E-07)
export function general(n: number): string {
  if (!isFinite(n)) return "#NUM!";
  if (Object.is(n, -0)) n = 0;
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1e11 || a < 1e-6) return expo(n);
  for (let d = 10; d > 0; d--) {
    const s = String(Number(roundHalfAway(n, d).toFixed(d)));
    if (s.length <= 11) return s;
  }
  return String(roundHalfAway(n, 0));
}

// 비교 — 숫자 < 글자 < 논리값, 글자는 대소문자 무시
function cmp(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const rank = (x: Scalar) => (typeof x === "number" ? 1 : typeof x === "string" ? 2 : 3);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "number") return Math.sign(a - (b as number));
  if (typeof a === "string") {
    const x = a.toLowerCase();
    const y = (b as string).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
}

// 배열끼리 연산 — 한 칸짜리·한 줄짜리는 늘여 맞춘다
function lift2(a: Val, b: Val, f: (x: Scalar, y: Scalar) => Scalar): Val {
  if (!isArr(a) && !isArr(b)) return f(a, b);
  const A = isArr(a) ? a : [[a]];
  const B = isArr(b) ? b : [[b]];
  const rows = Math.max(A.length, B.length);
  const cols = Math.max(A[0].length, B[0].length);
  const pick = (M: Arr, i: number, j: number): Scalar => {
    const r = M.length === 1 ? 0 : i;
    const c = M[0].length === 1 ? 0 : j;
    return r < M.length && c < M[0].length ? M[r][c] : new XErr("#N/A");
  };
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => f(pick(A, i, j), pick(B, i, j))));
}
const lift1 = (a: Val, f: (x: Scalar) => Scalar): Val => (isArr(a) ? a.map((r) => r.map(f)) : f(a));

function arith(op: string, x: Scalar, y: Scalar): Scalar {
  const a = toNum(x);
  if (isErr(a)) return a;
  const b = toNum(y);
  if (isErr(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? new XErr("#DIV/0!", "0으로 나눌 수 없어요.") : a / b;
    default: {
      if (a === 0 && b === 0) return new XErr("#NUM!");
      const r = Math.pow(a, b);
      return isFinite(r) ? r : new XErr("#NUM!");
    }
  }
}

// ─────────────────────────────────────────────
// 조건 (COUNTIF·SUMIF·D함수)
// ─────────────────────────────────────────────
function wildcard(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "~" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

// prefix: D함수·고급 필터 조건 — 연산자 없는 글자는 "그 글자로 시작"이다 ("김" → 김*)
function matcher(crit: Scalar, prefix = false): (v: Scalar) => boolean {
  if (isErr(crit)) return () => false;
  if (crit === null) return (v) => v === null || v === "";
  if (typeof crit === "number") return (v) => (typeof v === "number" ? v === crit : typeof v === "string" && parseLiteral(v).v === crit);
  if (typeof crit === "boolean") return (v) => v === crit;
  const m = crit.match(/^(<=|>=|<>|=|<|>)?([\s\S]*)$/)!;
  const op = m[1] ?? "";
  const rest = m[2];
  if (rest === "") {
    if (op === "<>") return (v) => v !== null && v !== "";
    return (v) => v === null || v === "";
  }
  const lit = parseLiteral(rest);
  if (typeof lit.v === "number") {
    const n = lit.v;
    switch (op) {
      case "<":
        return (v) => typeof v === "number" && v < n;
      case ">":
        return (v) => typeof v === "number" && v > n;
      case "<=":
        return (v) => typeof v === "number" && v <= n;
      case ">=":
        return (v) => typeof v === "number" && v >= n;
      case "<>":
        return (v) => !(typeof v === "number" ? v === n : typeof v === "string" && parseLiteral(v).v === n);
      default:
        return (v) => (typeof v === "number" ? v === n : typeof v === "string" && parseLiteral(v).v === n);
    }
  }
  if (typeof lit.v === "boolean") {
    const b = lit.v;
    return op === "<>" ? (v) => v !== b : (v) => v === b;
  }
  const text = rest;
  if (op === "" || op === "=" || op === "<>") {
    const re = wildcard(prefix && op === "" ? text + "*" : text);
    const hit = (v: Scalar) => typeof v === "string" && re.test(v);
    return op === "<>" ? (v) => !hit(v) : hit;
  }
  const t = text.toLowerCase();
  return (v) => {
    if (typeof v !== "string") return false;
    const x = v.toLowerCase();
    return op === "<" ? x < t : op === ">" ? x > t : op === "<=" ? x <= t : x >= t;
  };
}

// ─────────────────────────────────────────────
// TEXT 함수·셀 표시용 서식
// ─────────────────────────────────────────────
const WD_KO = ["일", "월", "화", "수", "목", "금", "토"];
const WD_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDate(n: number, fmt: string): string {
  const { y, m, d, wd } = fromSerial(n);
  const secs = Math.round((n - Math.floor(n)) * 86400);
  const hh = Math.floor(secs / 3600) % 24;
  const mi = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  const ampm = /AM\/PM|오전\/오후/i.test(fmt);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const pad = (x: number) => String(x).padStart(2, "0");
  // 토큰 단위로 바꾼다. m은 h 뒤·s 앞이면 분, 아니면 월
  const toks = fmt.match(/"[^"]*"|\\.|\[h+\]|\[m+\]|\[s+\]|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|aaaa|aaa|hh|h|ss|s|AM\/PM|오전\/오후|./gi) ?? [];
  const total = Math.round(n * 86400); // 경과 시간 [h]:mm — 24시간을 넘겨도 그대로 센다
  let out = "";
  let prevH = false;
  toks.forEach((tk, i) => {
    const l = tk.toLowerCase();
    const nextS = toks.slice(i + 1).find((x) => /^[hmsd]/i.test(x))?.toLowerCase().startsWith("s");
    if (tk.startsWith('"')) out += tk.slice(1, -1);
    else if (tk.startsWith("\\")) out += tk.slice(1);
    else if (/^\[h+\]$/.test(l)) out += String(Math.floor(total / 3600)).padStart(tk.length - 2, "0");
    else if (/^\[m+\]$/.test(l)) out += String(Math.floor(total / 60)).padStart(tk.length - 2, "0");
    else if (/^\[s+\]$/.test(l)) out += String(total).padStart(tk.length - 2, "0");
    else if (l === "yyyy") out += y;
    else if (l === "yy") out += pad(y % 100);
    else if (l === "mmmm") out += MON_EN[m - 1];
    else if (l === "mmm") out += MON_EN[m - 1].slice(0, 3);
    else if (l === "mm" || l === "m") {
      const v = prevH || nextS ? mi : m;
      out += l === "mm" ? pad(v) : v;
    } else if (l === "dddd") out += WD_EN[wd];
    else if (l === "ddd") out += WD_EN[wd].slice(0, 3);
    else if (l === "dd") out += pad(d);
    else if (l === "d") out += d;
    else if (l === "aaaa") out += `${WD_KO[wd]}요일`;
    else if (l === "aaa") out += WD_KO[wd];
    else if (l === "hh") out += pad(ampm ? h12 : hh);
    else if (l === "h") out += ampm ? h12 : hh;
    else if (l === "ss") out += pad(ss);
    else if (l === "s") out += ss;
    else if (l === "am/pm") out += hh < 12 ? "AM" : "PM";
    else if (tk === "오전/오후") out += hh < 12 ? "오전" : "오후";
    else out += tk;
    if (/^\[?h/.test(l)) prevH = true;
    else if (/^[ydms]/.test(l)) prevH = false;
  });
  return out;
}

function formatNumber(n: number, section: string): string {
  // 따옴표 글자·역슬래시 글자는 그대로 두고 숫자 자리표시(0 # , .)만 바꾼다
  const fmt = section;
  const masked = fmt.replace(/"[^"]*"|\\./g, (s) => " ".repeat(s.length));
  const lit = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1");
  // 지수 서식 0.00E+00
  const sci = masked.match(/([0#]+)(?:\.([0#]*))?E([+-])(0+)/i);
  if (sci) {
    const dec = (sci[2] ?? "").length;
    let [mant, exp] = Math.abs(n).toExponential(dec).split("e");
    const e = Number(exp);
    exp = (e < 0 ? "-" : sci[3] === "+" ? "+" : "") + String(Math.abs(e)).padStart(sci[4].length, "0");
    if (n < 0) mant = "-" + mant;
    return lit(fmt.slice(0, sci.index)) + `${mant}E${exp}` + lit(fmt.slice(sci.index! + sci[0].length));
  }
  const pct = /%/.test(masked);
  if (pct) n *= 100;
  const core = masked.match(/[0#?][0#?,]*(\.[0#?]*)?|\.[0#?]+/);
  if (!core) return lit(fmt);
  // 숫자 자리 바로 뒤 쉼표 = 천 단위 생략 (#,##0, → 천 원 단위 / #,##0.0, → 1.2)
  const spec = core[0].replace(/,+$/, "");
  const trailing = masked.slice(core.index! + core[0].length).match(/^,+/)?.[0].length ?? 0;
  const scale = core[0].length - spec.length + trailing;
  const [ip, dp = ""] = spec.split(".");
  const decimals = dp.length;
  const minInt = (ip.match(/0/g) ?? []).length;
  const comma = ip.includes(",");
  const v = Math.abs(n) / Math.pow(1000, scale);
  const rounded = roundHalfAway(v, decimals);
  let [is, ds = ""] = rounded.toFixed(decimals).split(".");
  if (is === "0" && minInt === 0) is = "";
  is = is.padStart(minInt, "0");
  if (comma) is = is.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  // 소수 끝의 # 자리는 0이면 지운다
  const optional = (dp.match(/#+$/) ?? [""])[0].length;
  if (optional) ds = ds.replace(new RegExp(`0{1,${optional}}$`), "");
  // 서식에 소수점이 있으면 소수가 다 지워져도 점은 남는다 — 엑셀 TEXT(3,"#.##") = "3."
  const num = (n < 0 && rounded !== 0 ? "-" : "") + is + (spec.includes(".") ? "." + ds : "");
  const before = fmt.slice(0, core.index);
  const after = fmt.slice(core.index! + core[0].length + trailing);
  return lit(before) + num + lit(after);
}

export function formatValue(v: Scalar, fmt: string): string | XErr {
  if (isErr(v)) return v;
  const sections = fmt.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (typeof v === "string" && !(typeof parseLiteral(v).v === "number")) {
    const s = sections.length >= 4 ? sections[3] : sections.find((x) => x.includes("@"));
    return s ? s.replace(/"([^"]*)"/g, "$1").replace("@", v) : v;
  }
  const n = typeof v === "number" ? v : toNum(v);
  if (isErr(n)) return n;
  let sec = sections[0];
  let x = n;
  if (n < 0 && sections.length >= 2) {
    sec = sections[1];
    x = -n;
  } else if (n === 0 && sections.length >= 3) sec = sections[2];
  if (sec.trim().toLowerCase() === "general" || sec.trim() === "일반") return general(x);
  const bare = sec.replace(/"[^"]*"|\\./g, "");
  if (/[ydhs]|aaa|am\/pm|오전/i.test(bare) || (/m/i.test(bare) && !/[0#]/.test(bare))) return formatDate(x, sec);
  return formatNumber(x, sec);
}

// 반올림 계열 — 곱셈(4561.604*10) 대신 10진 지수를 옮겨 이진 소수 오차를 피한다.
// 엑셀처럼 유효숫자 15자리로 먼저 정리한다(0.1*3 = 0.30000000000000004 → 0.3)
function shiftDec(x: number, k: number): number {
  const [m, e = "0"] = String(x).split("e");
  return Number(`${m}e${Number(e) + k}`);
}
function roundWith(x: number, d: number, f: (v: number) => number): number {
  const a = Number(Math.abs(x).toPrecision(15));
  return Math.sign(x) * shiftDec(f(shiftDec(a, d)), -d) || 0;
}
const roundHalfAway = (x: number, d: number) => roundWith(x, d, Math.round);

// ─────────────────────────────────────────────
// 함수
// ─────────────────────────────────────────────
type Ctx = {
  ev: (n: Node) => Val;
  cur: { r: number; c: number };
  raw: (r: number, c: number) => string; // 칸에 입력한 그대로 (D함수 수식 조건용)
  area: (r0: number, c0: number, rows: number, cols: number) => Arr; // 시작 칸 기준 크기 맞춘 범위
  evalRaw: (raw: string, at: { r: number; c: number }) => Scalar; // 수식 하나를 그 자리에서 계산
};

// 참조 인수의 왼쪽 위 칸 (범위 크기를 다른 범위에 맞출 때)
const origin = (n: Node): { r: number; c: number } | null =>
  n.t === "ref" ? { r: n.r, c: n.c } : n.t === "range" ? { r: n.r0, c: n.c0 } : null;
type Fn = (c: Ctx, args: Node[]) => Val;

const fromRef = (n: Node) => n.t === "ref" || n.t === "range";
const need = (args: Node[], min: number, max = min) => {
  if (args.length < min || args.length > max)
    throw new XErr("#VALUE!", min === max ? `인수가 ${min}개 필요해요.` : `인수는 ${min}~${max}개예요.`);
};

// 집계용 숫자 모으기 — 범위 안: 숫자만 / 직접 쓴 값: 숫자·논리값·숫자 글자. 오류는 그대로 올린다
function numbers(c: Ctx, args: Node[], mode: "plain" | "a" = "plain"): number[] {
  const out: number[] = [];
  for (const a of args) {
    const v = c.ev(a);
    if (fromRef(a) || isArr(v)) {
      for (const x of flat(v)) {
        if (isErr(x)) throw x;
        if (typeof x === "number") out.push(x);
        else if (mode === "a" && x !== null) out.push(x === true ? 1 : 0); // AVERAGEA 등: 글자·FALSE=0, TRUE=1
      }
    } else {
      const n = toNum(v);
      if (isErr(n)) throw n;
      out.push(n);
    }
  }
  return out;
}

const scalarFn = (f: (...xs: Scalar[]) => Scalar, min: number, max = min): Fn => (c, args) => {
  need(args, min, max);
  const vals = args.map((a) => first(c.ev(a)));
  return f(...vals);
};
const numFn = (f: (...xs: number[]) => Scalar, min: number, max = min): Fn => (c, args) => {
  need(args, min, max);
  const ns: number[] = [];
  for (const a of args) {
    const n = toNum(c.ev(a));
    if (isErr(n)) return n;
    ns.push(n);
  }
  return f(...ns);
};
const strArg = (v: Scalar): string => {
  const s = toStr(v);
  if (isErr(s)) throw s;
  return s;
};
const numArg = (v: Scalar): number => {
  const n = toNum(v);
  if (isErr(n)) throw n;
  return n;
};

function areaOf(v: Val): Arr {
  return isArr(v) ? v : [[v]];
}

function rangeArg(c: Ctx, n: Node, what = "범위"): Arr {
  const v = c.ev(n);
  if (!isArr(v) && isErr(v)) throw v;
  if (!isArr(v) && n.t !== "ref") throw new XErr("#VALUE!", `${what} 자리에는 셀 범위를 넣어야 해요.`);
  return areaOf(v);
}

// 같은 크기의 범위 쌍에서 조건을 모두 만족하는 칸 번호
function ifsMask(c: Ctx, pairs: Node[]): boolean[] | XErr {
  let mask: boolean[] | null = null;
  let shape: string | null = null;
  for (let i = 0; i < pairs.length; i += 2) {
    const area = rangeArg(c, pairs[i]);
    const s = `${area.length}x${area[0].length}`;
    if (shape && s !== shape) return new XErr("#VALUE!", "조건 범위들의 크기가 서로 달라요.");
    shape = s;
    const crit = first(c.ev(pairs[i + 1]));
    const m = matcher(crit);
    const cells = area.flat();
    mask = cells.map((v, k) => (mask ? mask[k] : true) && m(v));
  }
  return mask ?? [];
}

function stdev(ns: number[], sample: boolean): number | XErr {
  const n = ns.length;
  if (n < (sample ? 2 : 1)) return new XErr("#DIV/0!");
  const mean = ns.reduce((s, x) => s + x, 0) / n;
  return ns.reduce((s, x) => s + (x - mean) ** 2, 0) / (sample ? n - 1 : n);
}

function lookupEq(lv: Scalar, v: Scalar): boolean {
  if (typeof lv === "string" && typeof v === "string") return wildcard(lv).test(v);
  return cmp(lv, v) === 0 && typeof lv === typeof v;
}

// 정렬된 목록에서 lv 이하인 마지막 위치 (엑셀 유사 일치)
function approxIndex(list: Scalar[], lv: Scalar, desc = false): number {
  let found = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null || typeof v !== typeof lv) continue;
    const k = cmp(v, lv);
    if (desc ? k >= 0 : k <= 0) found = i;
    else break;
  }
  return found;
}

// SUMIF·AVERAGEIF의 합계/평균 범위 — 엑셀은 왼쪽 위 칸만 보고 조건 범위와 같은 크기로 늘린다
// (=SUMIF(C2:C7,"영업",B2)는 B2:B7을 더한다)
function sizedLike(c: Ctx, n: Node, like: Arr, what: string): Scalar[] {
  const o = origin(n);
  return (o ? c.area(o.r, o.c, like.length, like[0].length) : rangeArg(c, n, what)).flat();
}

function dbFn(kind: "sum" | "avg" | "count" | "counta" | "max" | "min" | "get"): Fn {
  return (c, args) => {
    need(args, kind === "count" || kind === "counta" ? 2 : 3, 3);
    const db = rangeArg(c, args[0], "데이터베이스");
    const head = db[0].map((h) => String(h ?? "").trim().toLowerCase());
    let col = -1;
    let crNode = args[2];
    if (args.length === 2) crNode = args[1];
    else {
      const f = first(c.ev(args[1]));
      if (typeof f === "number") col = f - 1;
      else if (typeof f === "string") col = head.indexOf(f.trim().toLowerCase());
      else if (f !== null) return new XErr("#VALUE!");
      if (f !== null && (col < 0 || col >= head.length)) return new XErr("#VALUE!", "필드(열 이름)를 데이터베이스 첫 행에서 찾지 못했어요.");
    }
    const cr = rangeArg(c, crNode, "조건");
    const crHead = cr[0].map((h) => String(h ?? "").trim().toLowerCase());
    const crAt = origin(crNode);
    // 조건 한 칸: 머리가 데이터 열 이름이면 값 조건, 머리가 데이터에 없는데 수식이면 "수식 조건"
    // (=C2>AVERAGE($C$2:$C$7) 처럼 첫 레코드 행을 가리키게 쓰고, 레코드마다 한 행씩 내려 계산)
    type Cond = { j: number; m: (v: Scalar) => boolean } | { formula: string; at: { r: number; c: number } };
    const conds: Cond[][] = cr.slice(1).map((row, ri) =>
      row.flatMap((v, j): Cond[] => {
        const field = head.indexOf(crHead[j]);
        const raw = crAt ? c.raw(crAt.r + 1 + ri, crAt.c + j) : "";
        if (field < 0 && raw.startsWith("=") && raw.length > 1)
          return [{ formula: raw, at: { r: crAt!.r + 1 + ri, c: crAt!.c + j } }];
        if (field < 0 || v === null || v === "") return [];
        return [{ j: field, m: matcher(v, true) }];
      })
    );
    const hit = (cd: Cond, r: Scalar[], i: number) =>
      "formula" in cd ? toBool(c.evalRaw(shiftFormula(cd.formula, i, 0), cd.at)) === true : cd.m(r[cd.j]);
    const rows = db.slice(1).filter((r, i) => conds.length === 0 || conds.some((cs) => cs.every((cd) => hit(cd, r, i))));
    const vals = col >= 0 ? rows.map((r) => r[col]) : rows.map((r) => r.find((v) => typeof v === "number") ?? null);
    const nums = vals.filter((v): v is number => typeof v === "number");
    switch (kind) {
      case "sum":
        return nums.reduce((s, x) => s + x, 0);
      case "avg":
        return nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : new XErr("#DIV/0!");
      case "count":
        return nums.length;
      case "counta":
        return col >= 0 ? vals.filter((v) => v !== null && v !== "").length : rows.length;
      case "max":
        return nums.length ? Math.max(...nums) : 0;
      case "min":
        return nums.length ? Math.min(...nums) : 0;
      default:
        return vals.length === 1 ? vals[0] : new XErr(vals.length ? "#NUM!" : "#VALUE!");
    }
  };
}

function eomonth(start: number, months: number): number {
  const { y, m } = fromSerial(start);
  return toSerial(y, m + months + 1, 0);
}

function isWorkday(n: number, holidays: Set<number>): boolean {
  const wd = fromSerial(n).wd;
  return wd !== 0 && wd !== 6 && !holidays.has(n);
}
function holidaySet(c: Ctx, n?: Node): Set<number> {
  if (!n) return new Set();
  return new Set(flat(c.ev(n)).filter((x): x is number => typeof x === "number").map(Math.floor));
}

export const FUNCS: Record<string, Fn> = {
  // ── 수학
  SUM: (c, a) => numbers(c, a).reduce((s, x) => s + x, 0),
  PRODUCT: (c, a) => numbers(c, a).reduce((s, x) => s * x, 1),
  ABS: numFn(Math.abs, 1),
  INT: numFn(Math.floor, 1),
  SIGN: numFn(Math.sign, 1),
  SQRT: numFn((x) => (x < 0 ? new XErr("#NUM!", "음수의 제곱근은 구할 수 없어요.") : Math.sqrt(x)), 1),
  POWER: numFn((x, y) => arith("^", x, y), 2),
  MOD: numFn((n, d) => (d === 0 ? new XErr("#DIV/0!") : n - d * Math.floor(n / d)), 2),
  QUOTIENT: numFn((n, d) => (d === 0 ? new XErr("#DIV/0!") : Math.trunc(n / d)), 2),
  ROUND: numFn((x, d) => roundHalfAway(x, Math.trunc(d)), 2),
  ROUNDUP: numFn((x, d) => roundWith(x, Math.trunc(d), Math.ceil), 2),
  ROUNDDOWN: numFn((x, d) => roundWith(x, Math.trunc(d), Math.floor), 2),
  TRUNC: (c, a) => {
    need(a, 1, 2);
    return FUNCS.ROUNDDOWN(c, [a[0], a[1] ?? { t: "num", v: 0 }]);
  },
  // 양수를 음수 배수로 올리거나 내리면 엑셀은 #NUM!
  CEILING: numFn((x, s) => (s === 0 ? 0 : x > 0 && s < 0 ? new XErr("#NUM!") : Math.ceil(Number((x / s).toPrecision(15))) * s), 2),
  FLOOR: numFn((x, s) => (s === 0 ? new XErr("#DIV/0!") : x > 0 && s < 0 ? new XErr("#NUM!") : Math.floor(Number((x / s).toPrecision(15))) * s), 2),
  EVEN: numFn((x) => Math.sign(x) * Math.ceil(Math.abs(x) / 2) * 2, 1),
  ODD: numFn((x) => {
    const v = Math.ceil(Math.abs(x));
    return Math.sign(x || 1) * (v % 2 ? v : v + 1);
  }, 1),
  FACT: numFn((x) => {
    if (x < 0) return new XErr("#NUM!");
    let r = 1;
    for (let i = 2; i <= Math.floor(x); i++) r *= i;
    return r;
  }, 1),
  PI: () => Math.PI,
  EXP: numFn(Math.exp, 1),
  LN: numFn((x) => (x <= 0 ? new XErr("#NUM!") : Math.log(x)), 1),
  LOG10: numFn((x) => (x <= 0 ? new XErr("#NUM!") : Math.log10(x)), 1),
  LOG: (c, a) => {
    need(a, 1, 2);
    return numFn((x, b) => (x <= 0 || b <= 0 || b === 1 ? new XErr("#NUM!") : Math.log(x) / Math.log(b)), 2)(c, [a[0], a[1] ?? { t: "num", v: 10 }]);
  },
  RAND: () => Math.random(),
  RANDBETWEEN: numFn((lo, hi) => Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) + Math.ceil(lo), 2),
  SUMPRODUCT: (c, a) => {
    if (!a.length) throw new XErr("#VALUE!");
    const arrs = a.map((n) => areaOf(c.ev(n)));
    const size = arrs[0].flat().length;
    if (arrs.some((x) => x.flat().length !== size)) return new XErr("#VALUE!", "범위 크기가 서로 달라요.");
    let s = 0;
    for (let i = 0; i < size; i++) {
      let p = 1;
      for (const x of arrs) {
        const v = x.flat()[i];
        if (isErr(v)) return v;
        p *= typeof v === "number" ? v : typeof v === "boolean" && a.length === 1 ? Number(v) : 0;
      }
      s += p;
    }
    return s;
  },
  SUMIF: (c, a) => {
    need(a, 2, 3);
    const crit = rangeArg(c, a[0]);
    const area = crit.flat();
    const sum = a[2] ? sizedLike(c, a[2], crit, "합계 범위") : area;
    const m = matcher(first(c.ev(a[1])));
    let s = 0;
    area.forEach((v, i) => {
      if (m(v) && typeof sum[i] === "number") s += sum[i] as number;
    });
    return s;
  },
  SUMIFS: (c, a) => {
    if (a.length < 3 || a.length % 2 === 0) throw new XErr("#VALUE!", "SUMIFS(합계 범위, 조건 범위1, 조건1, …)");
    const sum = rangeArg(c, a[0], "합계 범위").flat();
    const mask = ifsMask(c, a.slice(1));
    if (isErr(mask)) return mask;
    if (mask.length !== sum.length) return new XErr("#VALUE!", "합계 범위와 조건 범위의 크기가 달라요.");
    return sum.reduce<number>((s, v, i) => s + (mask[i] && typeof v === "number" ? v : 0), 0);
  },

  // ── 통계
  AVERAGE: (c, a) => {
    const ns = numbers(c, a);
    return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : new XErr("#DIV/0!", "평균 낼 숫자가 없어요.");
  },
  AVERAGEA: (c, a) => {
    const ns = numbers(c, a, "a");
    return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : new XErr("#DIV/0!");
  },
  AVERAGEIF: (c, a) => {
    need(a, 2, 3);
    const crit = rangeArg(c, a[0]);
    const area = crit.flat();
    const avg = a[2] ? sizedLike(c, a[2], crit, "평균 범위") : area;
    const m = matcher(first(c.ev(a[1])));
    const ns = area.map((v, i) => (m(v) ? avg[i] : null)).filter((v): v is number => typeof v === "number");
    return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : new XErr("#DIV/0!", "조건에 맞는 숫자가 없어요.");
  },
  AVERAGEIFS: (c, a) => {
    if (a.length < 3 || a.length % 2 === 0) throw new XErr("#VALUE!", "AVERAGEIFS(평균 범위, 조건 범위1, 조건1, …)");
    const avg = rangeArg(c, a[0], "평균 범위").flat();
    const mask = ifsMask(c, a.slice(1));
    if (isErr(mask)) return mask;
    const ns = avg.filter((v, i) => mask[i] && typeof v === "number") as number[];
    return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : new XErr("#DIV/0!");
  },
  COUNT: (c, a) => {
    let n = 0;
    for (const x of a) {
      const v = c.ev(x);
      if (fromRef(x) || isArr(v)) n += flat(v).filter((y) => typeof y === "number").length;
      else if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && typeof parseLiteral(v).v === "number")) n++;
    }
    return n;
  },
  COUNTA: (c, a) => a.reduce((n, x) => n + flat(c.ev(x)).filter((y) => y !== null).length, 0),
  COUNTBLANK: (c, a) => {
    need(a, 1);
    return rangeArg(c, a[0]).flat().filter((v) => v === null || v === "").length;
  },
  COUNTIF: (c, a) => {
    need(a, 2);
    const m = matcher(first(c.ev(a[1])));
    return rangeArg(c, a[0]).flat().filter(m).length;
  },
  COUNTIFS: (c, a) => {
    if (a.length < 2 || a.length % 2) throw new XErr("#VALUE!", "COUNTIFS(조건 범위1, 조건1, …)");
    const mask = ifsMask(c, a);
    return isErr(mask) ? mask : mask.filter(Boolean).length;
  },
  MAX: (c, a) => {
    const ns = numbers(c, a);
    return ns.length ? Math.max(...ns) : 0;
  },
  MIN: (c, a) => {
    const ns = numbers(c, a);
    return ns.length ? Math.min(...ns) : 0;
  },
  MAXA: (c, a) => {
    const ns = numbers(c, a, "a");
    return ns.length ? Math.max(...ns) : 0;
  },
  MINA: (c, a) => {
    const ns = numbers(c, a, "a");
    return ns.length ? Math.min(...ns) : 0;
  },
  LARGE: (c, a) => {
    need(a, 2);
    const ns = numbers(c, [a[0]]).sort((x, y) => y - x);
    const k = numArg(first(c.ev(a[1])));
    return k >= 1 && k <= ns.length ? ns[Math.ceil(k) - 1] : new XErr("#NUM!", "k가 범위를 벗어났어요.");
  },
  SMALL: (c, a) => {
    need(a, 2);
    const ns = numbers(c, [a[0]]).sort((x, y) => x - y);
    const k = numArg(first(c.ev(a[1])));
    return k >= 1 && k <= ns.length ? ns[Math.ceil(k) - 1] : new XErr("#NUM!", "k가 범위를 벗어났어요.");
  },
  MEDIAN: (c, a) => {
    const ns = numbers(c, a).sort((x, y) => x - y);
    if (!ns.length) return new XErr("#NUM!");
    const h = Math.floor(ns.length / 2);
    return ns.length % 2 ? ns[h] : (ns[h - 1] + ns[h]) / 2;
  },
  MODE: (c, a) => {
    // 횟수가 같으면 **먼저 나온 값** — 엑셀과 같다
    const ns = numbers(c, a);
    const cnt = new Map<number, number>();
    for (const x of ns) cnt.set(x, (cnt.get(x) ?? 0) + 1);
    const top = Math.max(0, ...cnt.values());
    return top < 2 ? new XErr("#N/A", "두 번 이상 나온 값이 없어요.") : ns.find((x) => cnt.get(x) === top)!;
  },
  RANK: (c, a) => {
    need(a, 2, 3);
    const x = numArg(first(c.ev(a[0])));
    const ns = numbers(c, [a[1]]);
    const asc = a[2] ? numArg(first(c.ev(a[2]))) !== 0 : false;
    if (!ns.includes(x)) return new XErr("#N/A", "순위를 구할 값이 범위 안에 없어요.");
    return 1 + ns.filter((y) => (asc ? y < x : y > x)).length;
  },
  STDEV: (c, a) => {
    const v = stdev(numbers(c, a), true);
    return isErr(v) ? v : Math.sqrt(v);
  },
  STDEVP: (c, a) => {
    const v = stdev(numbers(c, a), false);
    return isErr(v) ? v : Math.sqrt(v);
  },
  VAR: (c, a) => stdev(numbers(c, a), true),
  VARP: (c, a) => stdev(numbers(c, a), false),

  // ── 논리
  IF: (c, a) => {
    need(a, 2, 3);
    const cond = c.ev(a[0]);
    if (isArr(cond) && !(cond.length === 1 && cond[0].length === 1))
      return lift1(cond, (x) => {
        const b = toBool(x);
        return isErr(b) ? b : first(b ? c.ev(a[1]) : a[2] ? c.ev(a[2]) : false);
      });
    const b = toBool(cond);
    if (isErr(b)) return b;
    return b ? c.ev(a[1]) : a[2] ? c.ev(a[2]) : false;
  },
  IFS: (c, a) => {
    if (a.length < 2 || a.length % 2) throw new XErr("#VALUE!", "IFS(조건1, 값1, 조건2, 값2, …)");
    for (let i = 0; i < a.length; i += 2) {
      const b = toBool(c.ev(a[i]));
      if (isErr(b)) return b;
      if (b) return c.ev(a[i + 1]);
    }
    return new XErr("#N/A", "참인 조건이 하나도 없어요.");
  },
  IFERROR: (c, a) => {
    need(a, 2);
    const v = c.ev(a[0]);
    return isErr(first(v)) ? c.ev(a[1]) : v;
  },
  AND: (c, a) => logic(c, a, "and"),
  OR: (c, a) => logic(c, a, "or"),
  XOR: (c, a) => logic(c, a, "xor"),
  NOT: scalarFn((x) => {
    const b = toBool(x);
    return isErr(b) ? b : !b;
  }, 1),
  TRUE: () => true,
  FALSE: () => false,
  SWITCH: (c, a) => {
    if (a.length < 3) throw new XErr("#VALUE!", "SWITCH(식, 값1, 결과1, …, [기본값])");
    const x = first(c.ev(a[0]));
    if (isErr(x)) return x;
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (cmp(x, first(c.ev(a[i]))) === 0) return c.ev(a[i + 1]);
    return i < a.length ? c.ev(a[i]) : new XErr("#N/A", "일치하는 값이 없어요.");
  },
  ISBLANK: scalarFn((x) => x === null, 1),
  ISERROR: (c, a) => {
    need(a, 1);
    return isErr(first(c.ev(a[0])));
  },
  ISERR: (c, a) => {
    need(a, 1);
    const v = first(c.ev(a[0]));
    return isErr(v) && v.code !== "#N/A";
  },
  ISNA: (c, a) => {
    need(a, 1);
    const v = first(c.ev(a[0]));
    return isErr(v) && v.code === "#N/A";
  },
  NA: () => new XErr("#N/A"),
  "ERROR.TYPE": (c, a) => {
    need(a, 1);
    const v = first(c.ev(a[0]));
    const order: ErrCode[] = ["#NULL!" as ErrCode, "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"];
    return isErr(v) && order.includes(v.code) ? order.indexOf(v.code) + 1 : new XErr("#N/A");
  },
  ISNUMBER: scalarFn((x) => typeof x === "number", 1),
  ISTEXT: scalarFn((x) => typeof x === "string", 1),
  ISLOGICAL: scalarFn((x) => typeof x === "boolean", 1),
  ISEVEN: numFn((x) => Math.trunc(x) % 2 === 0, 1),
  ISODD: numFn((x) => Math.abs(Math.trunc(x)) % 2 === 1, 1),

  // ── 문자
  LEFT: (c, a) => {
    need(a, 1, 2);
    const s = strArg(first(c.ev(a[0])));
    const n = a[1] ? numArg(first(c.ev(a[1]))) : 1;
    return n < 0 ? new XErr("#VALUE!") : s.slice(0, Math.floor(n));
  },
  RIGHT: (c, a) => {
    need(a, 1, 2);
    const s = strArg(first(c.ev(a[0])));
    const n = a[1] ? numArg(first(c.ev(a[1]))) : 1;
    return n < 0 ? new XErr("#VALUE!") : Math.floor(n) === 0 ? "" : s.slice(-Math.floor(n));
  },
  MID: (c, a) => {
    need(a, 3);
    const s = strArg(first(c.ev(a[0])));
    const st = numArg(first(c.ev(a[1])));
    const n = numArg(first(c.ev(a[2])));
    if (st < 1 || n < 0) return new XErr("#VALUE!", "시작 위치는 1 이상, 글자 수는 0 이상이어야 해요.");
    return s.substr(Math.floor(st) - 1, Math.floor(n));
  },
  LEN: scalarFn((x) => {
    const s = toStr(x);
    return isErr(s) ? s : s.length;
  }, 1),
  UPPER: scalarFn((x) => {
    const s = toStr(x);
    return isErr(s) ? s : s.toUpperCase();
  }, 1),
  LOWER: scalarFn((x) => {
    const s = toStr(x);
    return isErr(s) ? s : s.toLowerCase();
  }, 1),
  PROPER: scalarFn((x) => {
    const s = toStr(x);
    return isErr(s) ? s : s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, p, ch) => p + ch.toUpperCase());
  }, 1),
  TRIM: scalarFn((x) => {
    const s = toStr(x);
    return isErr(s) ? s : s.replace(/ +/g, " ").trim();
  }, 1),
  REPLACE: (c, a) => {
    need(a, 4);
    const s = strArg(first(c.ev(a[0])));
    const st = numArg(first(c.ev(a[1])));
    const n = numArg(first(c.ev(a[2])));
    const r = strArg(first(c.ev(a[3])));
    if (st < 1 || n < 0) return new XErr("#VALUE!");
    return s.slice(0, st - 1) + r + s.slice(st - 1 + n);
  },
  SUBSTITUTE: (c, a) => {
    need(a, 3, 4);
    const s = strArg(first(c.ev(a[0])));
    const o = strArg(first(c.ev(a[1])));
    const r = strArg(first(c.ev(a[2])));
    if (!o) return s;
    if (!a[3]) return s.split(o).join(r);
    const k = numArg(first(c.ev(a[3])));
    let idx = -1;
    for (let i = 0; i < k; i++) {
      idx = s.indexOf(o, idx + 1);
      if (idx < 0) return s;
    }
    return s.slice(0, idx) + r + s.slice(idx + o.length);
  },
  FIND: (c, a) => findFn(c, a, false),
  SEARCH: (c, a) => findFn(c, a, true),
  CONCATENATE: (c, a) => a.map((x) => strArg(first(c.ev(x)))).join(""),
  CONCAT: (c, a) => a.flatMap((x) => flat(c.ev(x)).map(strArg)).join(""),
  REPT: (c, a) => {
    need(a, 2);
    const s = strArg(first(c.ev(a[0])));
    const n = numArg(first(c.ev(a[1])));
    return n < 0 ? new XErr("#VALUE!") : s.repeat(Math.floor(n));
  },
  TEXT: (c, a) => {
    need(a, 2);
    return formatValue(first(c.ev(a[0])), strArg(first(c.ev(a[1]))));
  },
  VALUE: scalarFn((x) => {
    if (typeof x === "number") return x;
    const s = toStr(x);
    if (isErr(s)) return s;
    const v = parseLiteral(s.trim()).v;
    return typeof v === "number" ? v : new XErr("#VALUE!", `"${s}"는 숫자로 바꿀 수 없어요.`);
  }, 1),
  EXACT: (c, a) => {
    need(a, 2);
    return strArg(first(c.ev(a[0]))) === strArg(first(c.ev(a[1])));
  },
  FIXED: (c, a) => {
    need(a, 1, 3);
    const n = numArg(first(c.ev(a[0])));
    const d = a[1] ? numArg(first(c.ev(a[1]))) : 2;
    const noComma = a[2] ? toBool(c.ev(a[2])) === true : false;
    const r = roundHalfAway(n, d).toFixed(Math.max(0, d));
    return noComma ? r : r.replace(/^(-?\d+)/, (m) => m.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  },

  // ── 날짜·시간
  TODAY: () => todaySerial(),
  NOW: () => {
    const t = new Date();
    return todaySerial() + (t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds()) / 86400;
  },
  DATE: numFn((y, m, d) => {
    const yy = y < 1900 ? y + 1900 : y;
    const s = toSerial(Math.floor(yy), Math.floor(m), Math.floor(d));
    return s < 0 ? new XErr("#NUM!") : s;
  }, 3),
  TIME: numFn((h, m, s) => (((h * 3600 + m * 60 + s) / 86400) % 1 + 1) % 1, 3),
  YEAR: numFn((n) => fromSerial(n).y, 1),
  MONTH: numFn((n) => fromSerial(n).m, 1),
  DAY: numFn((n) => fromSerial(n).d, 1),
  HOUR: numFn((n) => Math.floor(Math.round((n % 1) * 86400) / 3600) % 24, 1),
  MINUTE: numFn((n) => Math.floor((Math.round((n % 1) * 86400) % 3600) / 60), 1),
  SECOND: numFn((n) => Math.round((n % 1) * 86400) % 60, 1),
  WEEKDAY: (c, a) => {
    need(a, 1, 2);
    const n = numArg(first(c.ev(a[0])));
    const type = a[1] ? numArg(first(c.ev(a[1]))) : 1;
    const wd = fromSerial(n).wd; // 0=일
    if (type === 1) return wd + 1;
    if (type === 2) return ((wd + 6) % 7) + 1;
    if (type === 3) return (wd + 6) % 7;
    // 11~17: 월(11)·화(12)…일(17)을 1로 세는 유형 (엑셀 2010~)
    if (type >= 11 && type <= 17) return ((wd - ((type - 10) % 7) + 7) % 7) + 1;
    return new XErr("#NUM!", "WEEKDAY 유형은 1·2·3 또는 11~17이에요.");
  },
  DAYS: numFn((e, s) => Math.floor(e) - Math.floor(s), 2),
  EDATE: numFn((s, m) => {
    const { y, m: mo, d } = fromSerial(s);
    const last = fromSerial(eomonth(s, Math.trunc(m))).d;
    return toSerial(y, mo + Math.trunc(m), Math.min(d, last));
  }, 2),
  EOMONTH: numFn((s, m) => eomonth(s, Math.trunc(m)), 2),
  WORKDAY: (c, a) => {
    need(a, 2, 3);
    let n = Math.floor(numArg(first(c.ev(a[0]))));
    let k = Math.trunc(numArg(first(c.ev(a[1]))));
    const hol = holidaySet(c, a[2]);
    const step = k < 0 ? -1 : 1;
    while (k !== 0) {
      n += step;
      if (isWorkday(n, hol)) k -= step;
    }
    return n;
  },
  NETWORKDAYS: (c, a) => {
    need(a, 2, 3);
    let s = Math.floor(numArg(first(c.ev(a[0]))));
    let e = Math.floor(numArg(first(c.ev(a[1]))));
    const sign = s > e ? -1 : 1;
    if (s > e) [s, e] = [e, s];
    const hol = holidaySet(c, a[2]);
    let n = 0;
    for (let x = s; x <= e; x++) if (isWorkday(x, hol)) n++;
    return n * sign;
  },
  DATEVALUE: scalarFn((x) => {
    const s = toStr(x);
    if (isErr(s)) return s;
    const lit = parseLiteral(s.trim());
    return lit.f === "date" ? (lit.v as number) : new XErr("#VALUE!", `"${s}"는 날짜로 읽을 수 없어요.`);
  }, 1),

  // ── 찾기·참조
  VLOOKUP: (c, a) => lookupFn(c, a, "v"),
  HLOOKUP: (c, a) => lookupFn(c, a, "h"),
  LOOKUP: (c, a) => {
    need(a, 2, 3);
    const lv = first(c.ev(a[0]));
    const look = rangeArg(c, a[1]);
    const vec = look.length === 1 ? look[0] : look.map((r) => r[0]);
    const res = a[2] ? rangeArg(c, a[2]).flat() : look.length === 1 ? look[look.length - 1] : look.map((r) => r[r.length - 1]);
    const i = approxIndex(vec, lv);
    return i < 0 ? new XErr("#N/A") : res[i] ?? new XErr("#N/A");
  },
  MATCH: (c, a) => {
    need(a, 2, 3);
    const lv = first(c.ev(a[0]));
    const area = rangeArg(c, a[1]);
    if (area.length > 1 && area[0].length > 1) return new XErr("#N/A", "MATCH의 범위는 한 줄(행 또는 열)이어야 해요.");
    const list = area.flat();
    const type = a[2] ? numArg(first(c.ev(a[2]))) : 1;
    if (type === 0) {
      const i = list.findIndex((v) => lookupEq(lv, v));
      return i < 0 ? new XErr("#N/A", "같은 값을 찾지 못했어요.") : i + 1;
    }
    const i = approxIndex(list, lv, type < 0);
    return i < 0 ? new XErr("#N/A") : i + 1;
  },
  INDEX: (c, a) => {
    need(a, 2, 3);
    const area = rangeArg(c, a[0]);
    let r = numArg(first(c.ev(a[1])));
    let col = a[2] ? numArg(first(c.ev(a[2]))) : 0;
    if (!a[2] && area.length === 1) {
      col = r;
      r = 1;
    } else if (!a[2]) col = area[0].length === 1 ? 1 : 0;
    if (r < 0 || col < 0 || r > area.length || col > area[0].length) return new XErr("#REF!", "범위를 벗어난 위치예요.");
    if (r === 0 && col === 0) return area;
    if (r === 0) return area.map((row) => [row[col - 1]]);
    if (col === 0) return [area[r - 1]];
    return area[r - 1][col - 1];
  },
  CHOOSE: (c, a) => {
    if (a.length < 2) throw new XErr("#VALUE!", "CHOOSE(번호, 값1, 값2, …)");
    const i = Math.floor(numArg(first(c.ev(a[0]))));
    return i >= 1 && i < a.length ? c.ev(a[i]) : new XErr("#VALUE!", "번호가 값의 개수를 벗어났어요.");
  },
  ROW: (c, a) => (a[0] ? (a[0].t === "ref" ? a[0].r + 1 : a[0].t === "range" ? a[0].r0 + 1 : new XErr("#VALUE!")) : c.cur.r + 1),
  COLUMN: (c, a) => (a[0] ? (a[0].t === "ref" ? a[0].c + 1 : a[0].t === "range" ? a[0].c0 + 1 : new XErr("#VALUE!")) : c.cur.c + 1),
  ROWS: (c, a) => {
    need(a, 1);
    return areaOf(c.ev(a[0])).length;
  },
  COLUMNS: (c, a) => {
    need(a, 1);
    return areaOf(c.ev(a[0]))[0].length;
  },

  // ── 데이터베이스
  DSUM: dbFn("sum"),
  DAVERAGE: dbFn("avg"),
  DCOUNT: dbFn("count"),
  DCOUNTA: dbFn("counta"),
  DMAX: dbFn("max"),
  DMIN: dbFn("min"),
  DGET: dbFn("get"),
};
// 엑셀 2010 이후 이름 — 같은 계산
FUNCS["MODE.SNGL"] = FUNCS.MODE;
FUNCS["RANK.EQ"] = FUNCS.RANK;
FUNCS["STDEV.S"] = FUNCS.STDEV;
FUNCS["STDEV.P"] = FUNCS.STDEVP;
FUNCS["VAR.S"] = FUNCS.VAR;
FUNCS["VAR.P"] = FUNCS.VARP;
FUNCS["CEILING.MATH"] = FUNCS.CEILING;
FUNCS["FLOOR.MATH"] = FUNCS.FLOOR;

function logic(c: Ctx, a: Node[], kind: "and" | "or" | "xor"): Scalar {
  if (!a.length) throw new XErr("#VALUE!");
  const bs: boolean[] = [];
  for (const x of a) {
    const v = c.ev(x);
    if (fromRef(x) || isArr(v)) {
      for (const y of flat(v)) {
        if (isErr(y)) return y;
        if (typeof y === "boolean") bs.push(y);
        else if (typeof y === "number") bs.push(y !== 0);
      }
    } else {
      const b = toBool(v);
      if (isErr(b)) return b;
      bs.push(b);
    }
  }
  if (!bs.length) return new XErr("#VALUE!");
  if (kind === "and") return bs.every(Boolean);
  if (kind === "or") return bs.some(Boolean);
  return bs.filter(Boolean).length % 2 === 1;
}

function findFn(c: Ctx, a: Node[], search: boolean): Scalar {
  need(a, 2, 3);
  const f = strArg(first(c.ev(a[0])));
  const s = strArg(first(c.ev(a[1])));
  const st = a[2] ? numArg(first(c.ev(a[2]))) : 1;
  if (st < 1 || st > s.length + 1) return new XErr("#VALUE!");
  if (!search) {
    const i = s.indexOf(f, st - 1);
    return i < 0 ? new XErr("#VALUE!", `"${f}"을(를) 찾지 못했어요 (FIND는 대소문자를 구분해요).`) : i + 1;
  }
  const re = new RegExp(wildcard(f).source.slice(1, -1), "is");
  const m = re.exec(s.slice(st - 1));
  return m ? m.index + st : new XErr("#VALUE!", `"${f}"을(를) 찾지 못했어요.`);
}

function lookupFn(c: Ctx, a: Node[], dir: "v" | "h"): Scalar {
  need(a, 3, 4);
  const lv = first(c.ev(a[0]));
  if (isErr(lv)) return lv;
  const area = rangeArg(c, a[1], "표 범위");
  const k = Math.floor(numArg(first(c.ev(a[2]))));
  const approx = a[3] ? toBool(c.ev(a[3])) : true;
  if (isErr(approx)) return approx;
  const width = dir === "v" ? area[0].length : area.length;
  if (k < 1) return new XErr("#VALUE!", "열(행) 번호는 1 이상이에요.");
  if (k > width) return new XErr("#REF!", `범위가 ${width}${dir === "v" ? "열" : "행"}인데 ${k}번째를 달라고 했어요.`);
  const keys = dir === "v" ? area.map((r) => r[0]) : area[0];
  const i = approx ? approxIndex(keys, lv) : keys.findIndex((v) => lookupEq(lv, v));
  if (i < 0) return new XErr("#N/A", approx ? "찾는 값보다 작거나 같은 값이 첫 열에 없어요." : "같은 값을 찾지 못했어요.");
  const out = dir === "v" ? area[i][k - 1] : area[k - 1][i];
  return out === null ? 0 : out;
}

// 실제 엑셀엔 있지만 연습장에서 아직 안 되는 함수 — #NAME? 안내를 달리 한다
const KNOWN_UNSUPPORTED = new Set([
  "OFFSET", "INDIRECT", "XLOOKUP", "FILTER", "SORT", "UNIQUE", "SEQUENCE", "TEXTJOIN", "DATEDIF", "PMT", "FV", "PV",
  "NPV", "IRR", "RATE", "NPER", "FREQUENCY", "TRANSPOSE", "HYPERLINK", "CHAR", "CODE", "CELL", "INFO", "AREAS",
]);

// ─────────────────────────────────────────────
// 시트
// ─────────────────────────────────────────────
const astCache = new Map<string, Node | FormulaError>();
function astOf(raw: string): Node | FormulaError {
  let n = astCache.get(raw);
  if (!n) {
    try {
      n = parseFormula(raw.slice(1));
    } catch (e) {
      n = e instanceof FormulaError ? e : new FormulaError("수식을 이해하지 못했어요.");
    }
    if (astCache.size > 2000) astCache.clear();
    astCache.set(raw, n);
  }
  return n;
}

export type Cells = Record<string, string>; // "A1" → 입력한 그대로

export class Sheet {
  private cache = new Map<string, Scalar>();
  private visiting = new Set<string>();
  // 순환 참조에 걸린 칸 — 엑셀처럼 0으로 두고 경고만 한다
  private readonly circular = new Set<string>();
  constructor(private readonly cells: Cells) {}

  raw(r: number, c: number): string {
    return this.cells[addr(r, c)] ?? "";
  }

  isCircular(r: number, c: number): boolean {
    this.value(r, c);
    return this.circular.has(addr(r, c));
  }

  // 수식 하나를 칸에 넣지 않고 그 자리에서 계산 (D함수 수식 조건)
  evalRaw(raw: string, at: { r: number; c: number }): Scalar {
    const ast = astOf(raw);
    if (ast instanceof FormulaError) return new XErr("#NAME?", ast.message);
    try {
      return first(this.ev(ast, at));
    } catch (e) {
      return e instanceof XErr ? e : new XErr("#VALUE!");
    }
  }

  value(r: number, c: number): Scalar {
    const key = addr(r, c);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.visiting.has(key)) {
      // 고리에 든 칸 전부(처음 다시 만난 칸부터 지금까지) 순환으로 표시
      let on = false;
      for (const k of this.visiting) if ((on ||= k === key)) this.circular.add(k);
      return 0;
    }
    const raw = this.cells[key] ?? "";
    let v: Scalar;
    if (!raw.startsWith("=") || raw.length === 1) v = parseLiteral(raw).v;
    else {
      const ast = astOf(raw);
      if (ast instanceof FormulaError) v = new XErr("#NAME?", ast.message);
      else {
        this.visiting.add(key);
        try {
          v = first(this.ev(ast, { r, c }));
          if (v === null) v = 0; // =A1 (빈 칸) → 0
        } catch (e) {
          v = e instanceof XErr ? e : new XErr("#VALUE!");
        } finally {
          this.visiting.delete(key);
        }
        if (this.circular.has(key)) v = 0;
      }
    }
    this.cache.set(key, v);
    return v;
  }

  private ev(n: Node, cur: { r: number; c: number }): Val {
    switch (n.t) {
      case "num":
        return n.v;
      case "str":
        return n.v;
      case "bool":
        return n.v;
      case "err":
        return new XErr(n.v);
      case "arr":
        return n.rows.length === 1 && n.rows[0].length === 1 ? n.rows[0][0] : n.rows;
      case "name":
        return new XErr(
          "#NAME?",
          /[가-힣]/.test(n.v)
            ? `'${n.v}'는 이름 정의로 붙인 이름이에요 — 연습장은 이름 정의를 지원하지 않으니 셀 주소(예: A1:A5)로 바꿔 넣어 보세요. 글자라면 큰따옴표로 감싸요.`
            : `'${n.v}'는 함수도 셀 주소도 아니에요. 글자라면 큰따옴표로 감싸 주세요 ("${n.v}").`
        );
      case "ref":
        return this.value(n.r, n.c);
      case "range": {
        const out: Arr = [];
        const r1 = Math.min(n.r1, MAX_ROW - 1);
        for (let r = n.r0; r <= r1; r++) {
          const row: Scalar[] = [];
          for (let c = n.c0; c <= n.c1; c++) row.push(this.value(r, c));
          out.push(row);
        }
        return out;
      }
      case "neg":
        return lift1(this.ev(n.a, cur), (x) => {
          const v = toNum(x);
          return isErr(v) ? v : -v;
        });
      case "pct":
        return lift1(this.ev(n.a, cur), (x) => {
          const v = toNum(x);
          return isErr(v) ? v : v / 100;
        });
      case "bin": {
        const a = this.ev(n.a, cur);
        const b = this.ev(n.b, cur);
        if (n.op === "&")
          return lift2(a, b, (x, y) => {
            const s = toStr(x);
            if (isErr(s)) return s;
            const t = toStr(y);
            return isErr(t) ? t : s + t;
          });
        if (["=", "<>", "<", ">", "<=", ">="].includes(n.op))
          return lift2(a, b, (x, y) => {
            if (isErr(x)) return x;
            if (isErr(y)) return y;
            const k = cmp(x, y);
            return n.op === "=" ? k === 0 : n.op === "<>" ? k !== 0 : n.op === "<" ? k < 0 : n.op === ">" ? k > 0 : n.op === "<=" ? k <= 0 : k >= 0;
          });
        return lift2(a, b, (x, y) => arith(n.op, x, y));
      }
      case "call": {
        const f = FUNCS[n.name];
        if (!f)
          return new XErr(
            "#NAME?",
            KNOWN_UNSUPPORTED.has(n.name) ? `${n.name} 함수는 연습장에서 아직 지원하지 않아요.` : `${n.name}라는 함수는 없어요 — 철자를 확인해 보세요.`
          );
        // 함수 안에서 던진 오류(XErr)는 인수 경계에서 값으로 바꾼다 — 그래야 IFERROR·ISERROR가 잡는다
        const ctx: Ctx = {
          ev: (x) => {
            try {
              return this.ev(x, cur);
            } catch (e) {
              if (e instanceof XErr) return e;
              throw e;
            }
          },
          cur,
          raw: (r, c) => this.raw(r, c),
          area: (r0, c0, rows, cols) =>
            Array.from({ length: rows }, (_, i) =>
              Array.from({ length: cols }, (_, j) =>
                r0 + i < MAX_ROW && c0 + j < MAX_COL ? this.value(r0 + i, c0 + j) : null
              )
            ),
          evalRaw: (raw, at) => this.evalRaw(raw, at),
        };
        return f(ctx, n.args);
      }
    }
  }

  // 표시 형식 힌트 — 날짜 함수 결과·날짜 칸 참조는 날짜로 보여야 "44016" 같은 숫자가 안 뜬다
  fmt(r: number, c: number, depth = 0): Fmt {
    const raw = this.raw(r, c);
    if (!raw.startsWith("=")) return parseLiteral(raw).f;
    const ast = astOf(raw);
    return ast instanceof FormulaError || depth > 20 ? null : this.hint(ast, depth);
  }
  private hint(n: Node, depth: number): Fmt {
    if (n.t === "call") {
      if (["DATE", "TODAY", "EDATE", "EOMONTH", "WORKDAY", "DATEVALUE"].includes(n.name)) return "date";
      if (n.name === "NOW") return "datetime";
      if (n.name === "TIME") return "time";
      if (["IF", "IFERROR", "MAX", "MIN", "LARGE", "SMALL", "INDEX", "VLOOKUP", "HLOOKUP", "CHOOSE"].includes(n.name)) {
        for (const a of n.name === "IF" || n.name === "CHOOSE" ? n.args.slice(1) : n.args) {
          const h = this.hint(a, depth + 1);
          if (h === "date" || h === "time") return h;
        }
      }
      return null;
    }
    if (n.t === "ref") return this.fmt(n.r, n.c, depth + 1);
    if (n.t === "range") return this.fmt(n.r0, n.c0, depth + 1);
    if (n.t === "bin" && (n.op === "+" || n.op === "-")) {
      const a = this.hint(n.a, depth + 1);
      const b = this.hint(n.b, depth + 1);
      if (n.op === "-" && a === "date" && b === "date") return null; // 날짜 - 날짜 = 일수
      if (a === "date" || a === "time") return a;
      if (n.op === "+" && (b === "date" || b === "time")) return b;
      return a === "comma" || b === "comma" ? "comma" : null; // 1,000 + 2,000 → 3,000
    }
    if (n.t === "pct") return null;
    return null;
  }

  display(r: number, c: number): { text: string; align: "left" | "right" | "center"; error?: string } {
    const v = this.value(r, c);
    if (this.circular.has(addr(r, c))) return { text: "0", align: "right", error: ERR_HELP["#CIRC!"] };
    if (v === null) return { text: "", align: "left" };
    if (isErr(v)) return { text: v.code, align: "center", error: v.msg ?? ERR_HELP[v.code] };
    if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center" };
    if (typeof v === "string") return { text: v, align: "left" };
    const f = this.fmt(r, c);
    if (f === "date") return { text: formatDate(v, "yyyy-mm-dd"), align: "right" };
    if (f === "datetime") return { text: formatDate(v, "yyyy-mm-dd hh:mm"), align: "right" };
    if (f === "time") return { text: formatDate(v, "h:mm"), align: "right" };
    if (f === "percent") return { text: `${general(Number((v * 100).toPrecision(12)))}%`, align: "right" };
    if (f === "comma") return { text: withCommas(general(v)), align: "right" };
    return { text: general(v), align: "right" };
  }
}

export const ERR_HELP: Record<ErrCode, string> = {
  "#DIV/0!": "0으로 나누었어요.",
  "#N/A": "찾는 값이 없어요.",
  "#NAME?": "함수 이름이나 글자 표기가 잘못됐어요.",
  "#NUM!": "계산할 수 없는 숫자예요.",
  "#REF!": "없는 셀이나 범위를 참조했어요.",
  "#VALUE!": "값의 종류가 맞지 않아요 (예: 글자를 더하기).",
  "#CIRC!": "순환 참조 — 수식이 자기 자신을 참조해요.",
};

// 함수 도움말 — 입력 중인 함수의 인수 순서를 보여준다 (컴활2급 출제 함수 위주)
export const FUNC_HELP: Record<string, string> = {
  SUM: "SUM(수1, 수2, …)",
  AVERAGE: "AVERAGE(수1, 수2, …)",
  AVERAGEA: "AVERAGEA(값1, 값2, …) — 글자·FALSE는 0, TRUE는 1로 센다",
  COUNT: "COUNT(값1, …) — 숫자가 든 칸 수",
  COUNTA: "COUNTA(값1, …) — 비어 있지 않은 칸 수",
  COUNTBLANK: "COUNTBLANK(범위) — 빈 칸 수",
  COUNTIF: "COUNTIF(범위, 조건) — 조건 예: \">=80\", \"김*\"",
  COUNTIFS: "COUNTIFS(조건 범위1, 조건1, 조건 범위2, 조건2, …)",
  SUMIF: "SUMIF(조건 범위, 조건, [합계 범위])",
  SUMIFS: "SUMIFS(합계 범위, 조건 범위1, 조건1, …)",
  AVERAGEIF: "AVERAGEIF(조건 범위, 조건, [평균 범위])",
  AVERAGEIFS: "AVERAGEIFS(평균 범위, 조건 범위1, 조건1, …)",
  MAX: "MAX(수1, 수2, …)",
  MIN: "MIN(수1, 수2, …)",
  LARGE: "LARGE(범위, k) — k번째로 큰 값",
  SMALL: "SMALL(범위, k) — k번째로 작은 값",
  MEDIAN: "MEDIAN(수1, …) — 가운데 값",
  MODE: "MODE(수1, …) — 가장 많이 나온 값",
  "MODE.SNGL": "MODE.SNGL(수1, …) — 가장 많이 나온 값",
  RANK: "RANK(수, 범위, [방법]) — 방법 0/생략: 큰 값이 1등, 1: 작은 값이 1등",
  "RANK.EQ": "RANK.EQ(수, 범위, [방법]) — 방법 0/생략: 큰 값이 1등",
  STDEV: "STDEV(수1, …) — 표본 표준편차",
  "STDEV.S": "STDEV.S(수1, …) — 표본 표준편차",
  VAR: "VAR(수1, …) — 표본 분산",
  "VAR.S": "VAR.S(수1, …) — 표본 분산",
  IF: "IF(조건, 참일 때, [거짓일 때])",
  IFS: "IFS(조건1, 값1, 조건2, 값2, …)",
  IFERROR: "IFERROR(값, 오류일 때 값)",
  AND: "AND(조건1, 조건2, …) — 모두 참이면 TRUE",
  OR: "OR(조건1, 조건2, …) — 하나라도 참이면 TRUE",
  NOT: "NOT(조건)",
  SWITCH: "SWITCH(식, 값1, 결과1, …, [기본값])",
  ROUND: "ROUND(수, 자릿수) — 자릿수 -1이면 십의 자리에서 반올림",
  ROUNDUP: "ROUNDUP(수, 자릿수) — 올림",
  ROUNDDOWN: "ROUNDDOWN(수, 자릿수) — 내림",
  TRUNC: "TRUNC(수, [자릿수]) — 버림",
  INT: "INT(수) — 가장 가까운 작은 정수 (INT(-7.4) = -8)",
  MOD: "MOD(수, 나눌 수) — 나머지 (부호는 나눌 수를 따른다)",
  ABS: "ABS(수) — 절댓값",
  POWER: "POWER(수, 지수)",
  SQRT: "SQRT(수) — 양의 제곱근",
  PRODUCT: "PRODUCT(수1, …) — 곱",
  SUMPRODUCT: "SUMPRODUCT(범위1, 범위2, …) — 같은 위치끼리 곱해 더하기",
  QUOTIENT: "QUOTIENT(수, 나눌 수) — 몫(정수)",
  RAND: "RAND() — 0 이상 1 미만 난수",
  RANDBETWEEN: "RANDBETWEEN(최소, 최대) — 정수 난수",
  LEFT: "LEFT(글자, [개수])",
  RIGHT: "RIGHT(글자, [개수])",
  MID: "MID(글자, 시작 위치, 개수)",
  LEN: "LEN(글자) — 글자 수",
  UPPER: "UPPER(글자) — 대문자로",
  LOWER: "LOWER(글자) — 소문자로",
  PROPER: "PROPER(글자) — 단어 첫 글자만 대문자로",
  TRIM: "TRIM(글자) — 앞뒤 공백 제거, 사이 공백은 하나로",
  REPLACE: "REPLACE(글자, 시작 위치, 개수, 새 글자)",
  SUBSTITUTE: "SUBSTITUTE(글자, 찾을 글자, 바꿀 글자, [몇 번째])",
  FIND: "FIND(찾을 글자, 글자, [시작 위치]) — 대소문자 구분, 와일드카드 안 됨",
  SEARCH: "SEARCH(찾을 글자, 글자, [시작 위치]) — 대소문자 무시, 와일드카드 됨",
  CONCATENATE: "CONCATENATE(글자1, 글자2, …) — & 와 같다",
  CONCAT: "CONCAT(글자1 또는 범위, …)",
  REPT: "REPT(글자, 반복 횟수)",
  TEXT: "TEXT(값, \"표시 형식\") — 예: TEXT(A1, \"#,##0\"), TEXT(A1, \"yyyy-mm-dd\")",
  VALUE: "VALUE(글자) — 숫자로",
  EXACT: "EXACT(글자1, 글자2) — 대소문자까지 같으면 TRUE",
  TODAY: "TODAY() — 오늘 날짜",
  NOW: "NOW() — 지금 날짜와 시각",
  DATE: "DATE(연, 월, 일)",
  TIME: "TIME(시, 분, 초)",
  YEAR: "YEAR(날짜)",
  MONTH: "MONTH(날짜)",
  DAY: "DAY(날짜)",
  HOUR: "HOUR(시각)",
  MINUTE: "MINUTE(시각)",
  SECOND: "SECOND(시각)",
  WEEKDAY: "WEEKDAY(날짜, [유형]) — 유형 1/생략: 일=1…토=7, 2: 월=1…일=7, 3: 월=0…일=6",
  DAYS: "DAYS(끝 날짜, 시작 날짜) — 사이 일수",
  EDATE: "EDATE(시작 날짜, 개월 수) — 몇 달 뒤 같은 날",
  EOMONTH: "EOMONTH(시작 날짜, 개월 수) — 몇 달 뒤 그 달의 마지막 날",
  WORKDAY: "WORKDAY(시작 날짜, 일수, [휴일]) — 주말·휴일 빼고 며칠 뒤",
  NETWORKDAYS: "NETWORKDAYS(시작, 끝, [휴일]) — 사이의 평일 수",
  VLOOKUP: "VLOOKUP(찾을 값, 범위, 열 번호, [찾기 방법]) — 방법 FALSE/0: 정확히, TRUE/생략: 비슷하게",
  HLOOKUP: "HLOOKUP(찾을 값, 범위, 행 번호, [찾기 방법]) — 방법 FALSE/0: 정확히, TRUE/생략: 비슷하게",
  LOOKUP: "LOOKUP(찾을 값, 찾을 범위, [결과 범위])",
  MATCH: "MATCH(찾을 값, 범위, [방법]) — 위치 번호. 방법 0: 정확히, 1/생략: 이하 중 최대, -1: 이상 중 최소",
  INDEX: "INDEX(범위, 행 번호, [열 번호])",
  CHOOSE: "CHOOSE(번호, 값1, 값2, …)",
  ROW: "ROW([셀]) — 행 번호",
  COLUMN: "COLUMN([셀]) — 열 번호",
  ROWS: "ROWS(범위) — 행 개수",
  COLUMNS: "COLUMNS(범위) — 열 개수",
  ISBLANK: "ISBLANK(값) — 빈 칸이면 TRUE",
  ISERROR: "ISERROR(값) — 오류면 TRUE",
  ISNUMBER: "ISNUMBER(값) — 숫자면 TRUE",
  ISTEXT: "ISTEXT(값) — 글자면 TRUE",
  ISEVEN: "ISEVEN(수) — 짝수면 TRUE",
  ISODD: "ISODD(수) — 홀수면 TRUE",
  DSUM: "DSUM(데이터베이스, 필드, 조건 범위) — 조건 범위 첫 행은 열 이름",
  DAVERAGE: "DAVERAGE(데이터베이스, 필드, 조건 범위)",
  DCOUNT: "DCOUNT(데이터베이스, [필드], 조건 범위) — 숫자 칸 수",
  DCOUNTA: "DCOUNTA(데이터베이스, [필드], 조건 범위) — 비어 있지 않은 칸 수",
  DMAX: "DMAX(데이터베이스, 필드, 조건 범위)",
  DMIN: "DMIN(데이터베이스, 필드, 조건 범위)",
  DGET: "DGET(데이터베이스, 필드, 조건 범위) — 조건에 맞는 값 하나",
};

// ─────────────────────────────────────────────
// 복사·채우기 — 상대/절대 참조, 채우기 핸들 (컴활 단골: "채우기 핸들을 끌었을 때 [A3]에 입력되는 값은?")
// ─────────────────────────────────────────────
const STR_SPLIT = /("(?:[^"]|"")*")/;
const REF_IN_TEXT = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g;

// 수식을 dr행·dc열 옮겨 붙일 때 — $ 없는 쪽만 움직인다. 시트 밖으로 나가면 #REF!
export function shiftFormula(raw: string, dr: number, dc: number): string {
  if (!raw.startsWith("=")) return raw;
  return raw
    .split(STR_SPLIT)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(REF_IN_TEXT, (m, ac: string, col: string, ar: string, row: string) => {
              const c = ac ? colIndex(col) : colIndex(col) + dc;
              const r = ar ? Number(row) - 1 : Number(row) - 1 + dr;
              if (c < 0 || r < 0 || c >= MAX_COL || r >= MAX_ROW) return "#REF!";
              return `${ac}${colName(c)}${ar}${r + 1}`;
            })
            // 열 전체 참조 A:A — 열만 옮긴다
            .replace(COL_RANGE_IN_TEXT, (m, a1: string, c1: string, a2: string, c2: string) => {
              const x = a1 ? colIndex(c1) : colIndex(c1) + dc;
              const y = a2 ? colIndex(c2) : colIndex(c2) + dc;
              if (x < 0 || y < 0 || x >= MAX_COL || y >= MAX_COL) return "#REF!";
              return `${a1}${colName(x)}:${a2}${colName(y)}`;
            })
    )
    .join("");
}
const COL_RANGE_IN_TEXT = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/g;

// F4 — 커서가 있는 참조를 A1 → $A$1 → A$1 → $A1 → A1 로 돌린다
// 범위(E2:E6)면 양 끝을 함께 돌린다 — 끝 주소만 바꾸면 =RANK.EQ(E2,E2:$E$6)이 되어 채우면 순위가 틀어진다
const REF_OR_RANGE = /(?<![A-Za-z0-9_.$])\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?(?![A-Za-z0-9_(])/g;
export function cycleRef(text: string, caret: number): { text: string; caret: number } | null {
  // 커서가 문자열("A1") 안이면 주소가 아니라 글자다
  let inStr = false;
  for (let i = 0; i < caret && i < text.length; i++) if (text[i] === '"') inStr = !inStr;
  if (inStr) return null;
  let hit: { start: number; end: number; s: string } | null = null;
  text.split(STR_SPLIT).reduce((pos, part, i) => {
    if (i % 2 === 0)
      for (const m of part.matchAll(REF_OR_RANGE)) {
        const start = pos + (m.index ?? 0);
        const end = start + m[0].length;
        if (caret >= start && caret <= end) hit = { start, end, s: m[0] };
      }
    return pos + part.length;
  }, 0);
  if (!hit) return null;
  const h = hit as { start: number; end: number; s: string };
  const ends = h.s.split(":").map((x) => x.match(/^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/)!);
  const state = (ends[0][1] ? 2 : 0) + (ends[0][3] ? 1 : 0); // 0: A1, 3: $A$1, 1: A$1, 2: $A1
  const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[state as 0 | 1 | 2 | 3];
  const s = ends.map((m) => `${next & 2 ? "$" : ""}${m[2].toUpperCase()}${next & 1 ? "$" : ""}${m[4]}`).join(":");
  return { text: text.slice(0, h.start) + s + text.slice(h.end), caret: h.start + s.length };
}

// 엑셀 기본 제공 사용자 지정 목록 — 채우기 핸들로 끌면 다음 항목이 나온다
const LISTS: string[][] = [
  ["일", "월", "화", "수", "목", "금", "토"],
  ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  MON_EN,
  ["갑", "을", "병", "정", "무", "기", "경", "신", "임", "계"],
  ["자", "축", "인", "묘", "진", "사", "오", "미", "신", "유", "술", "해"],
  ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"],
  ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"],
  // 한국어판 목록 — 12월 다음은 13월이 아니라 1월
  ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"],
  ["1사분기", "2사분기", "3사분기", "4사분기"],
];
const listOf = (s: string) => LISTS.find((l) => l.some((x) => x.toLowerCase() === s.toLowerCase()));
const posIn = (l: string[], s: string) => l.findIndex((x) => x.toLowerCase() === s.toLowerCase());

// 채우기: 원본(끄는 방향 순서) → 이어지는 count칸의 입력값. step = 원본 한 칸이 시트에서 떨어진 거리(행·열 단위)
//  - 숫자 한 칸: 그대로 복사 (엑셀 기본. Ctrl 누르고 끌면 1씩 증가 — 연습장은 inc 인자로)
//  - 숫자 여러 칸: 등차(최소제곱) 계속
//  - 날짜 한 칸: 1일씩, 시간: 1시간씩
//  - 끝에 숫자가 붙은 글자("A1", "1월", "2020년"): 마지막 숫자를 1씩
//  - 사용자 지정 목록(월·화… / 갑·을… / 자·축…): 다음 항목
//  - 수식: 원본 위치에서 떨어진 만큼 상대 참조 이동
//  - 그 밖의 글자·논리값: 복사
//  - 위·왼쪽으로 끌면(dir 음수) 거꾸로 — src도 끄는 방향 순서(끝 칸이 채울 자리 바로 옆)로 받는다
export function fillSeries(src: string[], count: number, dir: { dr: number; dc: number }, inc = false): string[] {
  const n = src.length;
  const out: string[] = [];
  const sign = dir.dr < 0 || dir.dc < 0 ? -1 : 1;
  const lits = src.map((s) => parseLiteral(s));
  const allNum = src.every((s, i) => !s.startsWith("=") && typeof lits[i].v === "number");
  const f0 = lits[0].f;
  // 채운 값은 원본 서식 그대로 — 날짜는 날짜, 10%는 30%, 1,000은 3,000. 숫자는 15자리 그대로(10자리로 자르지 않는다)
  const asInput = (v: number) =>
    f0 === "date" ? formatDate(v, "yyyy-mm-dd")
    : f0 === "time" ? formatDate(v, "h:mm")
    : f0 === "percent" ? `${textOf(v * 100)}%`
    : f0 === "comma" ? withCommas(textOf(v))
    : textOf(v);
  if (allNum && (n >= 2 || inc || f0 === "date" || f0 === "time")) {
    const ys = lits.map((l) => l.v as number);
    let slope: number;
    let icpt: number;
    if (n === 1) {
      slope = (f0 === "time" ? 1 / 24 : 1) * sign;
      icpt = ys[0];
    } else {
      const mx = (n - 1) / 2;
      const my = ys.reduce((s, y) => s + y, 0) / n;
      let sxy = 0;
      let sxx = 0;
      ys.forEach((y, x) => {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) ** 2;
      });
      slope = sxy / sxx;
      icpt = my - slope * mx;
    }
    for (let j = 0; j < count; j++) out.push(asInput(Number((icpt + slope * (n + j)).toPrecision(15))));
    return out;
  }
  // 같은 목록 안의 항목들 — 목록 순서대로 이어 간다
  const list = src.every((s) => !s.startsWith("=")) ? listOf(src[0]) : undefined;
  if (list && src.every((s) => posIn(list, s) >= 0)) {
    const ps = src.map((s) => posIn(list, s));
    const step = n >= 2 ? ps[n - 1] - ps[n - 2] || sign : sign;
    for (let j = 1; j <= count; j++) out.push(list[(((ps[n - 1] + step * j) % list.length) + list.length) % list.length]);
    return out;
  }
  // 끝에 숫자가 붙은 글자 — 앞뒤 글자가 같으면 숫자만 등차로
  // (숫자 칸 자체는 제외 — 한 칸짜리 숫자는 위에서 걸러진 "복사" 대상이다)
  const parts = src.map((s, i) => (s.startsWith("=") || typeof lits[i].v === "number" ? null : s.match(/^(.*?)(\d+)(\D*)$/)));
  if (parts.every((p) => p) && parts.every((p) => p![1] === parts[0]![1] && p![3] === parts[0]![3])) {
    const nums = parts.map((p) => Number(p![2]));
    const step = n >= 2 ? nums[n - 1] - nums[n - 2] : sign;
    const width = parts[0]![2].length;
    for (let j = 1; j <= count; j++) {
      const v = nums[n - 1] + step * j;
      out.push(`${parts[0]![1]}${String(Math.abs(v)).padStart(width, "0")}${parts[0]![3]}`);
    }
    return out;
  }
  // 칸마다 따로 — 원본 묶음을 되풀이하면서 수식은 떨어진 만큼 옮기고, 숫자 붙은 글자는 바퀴마다 1씩
  for (let j = 0; j < count; j++) {
    const k = j % n;
    const lap = Math.floor(j / n) + 1;
    const s = src[k];
    if (s.startsWith("=")) out.push(shiftFormula(s, dir.dr * n * lap, dir.dc * n * lap));
    else if (parts[k]) out.push(`${parts[k]![1]}${Math.abs(Number(parts[k]![2]) + lap * sign)}${parts[k]![3]}`);
    else if (listOf(s)) {
      const l = listOf(s)!;
      out.push(l[(((posIn(l, s) + lap * sign) % l.length) + l.length) % l.length]);
    } else out.push(s);
  }
  return out;
}

// 입력 중인 수식에서 커서가 들어 있는 함수와 몇 번째 인수인지 (도움말 표시용)
export function funcContext(text: string): { name: string; arg: number } | null {
  const stack: { name: string; arg: number }[] = [];
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") {
      const m = text.slice(0, i).match(/([A-Za-z][A-Za-z0-9.]*)$/);
      stack.push({ name: m ? m[1].toUpperCase() : "", arg: 0 });
    } else if (ch === ")") stack.pop();
    else if (ch === "," && stack.length) stack[stack.length - 1].arg++;
  }
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return stack[i];
  return null;
}

// 수식 속 참조 칸 (입력 중 강조용)
export function refsIn(text: string): { r0: number; c0: number; r1: number; c1: number }[] {
  if (!text.startsWith("=")) return [];
  const out: { r0: number; c0: number; r1: number; c1: number }[] = [];
  const re = /(?<![A-Za-z0-9_.$])\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;
  text.split(STR_SPLIT).forEach((part, i) => {
    if (i % 2) return;
    for (const m of part.matchAll(re)) {
      const c0 = colIndex(m[1]);
      const r0 = Number(m[2]) - 1;
      const c1 = m[3] ? colIndex(m[3]) : c0;
      const r1 = m[4] ? Number(m[4]) - 1 : r0;
      out.push({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
    }
  });
  return out;
}
