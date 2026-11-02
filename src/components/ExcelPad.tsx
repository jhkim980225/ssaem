"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sheet,
  addr,
  colName,
  parseFormula,
  FormulaError,
  FUNCS,
  FUNC_HELP,
  shiftFormula,
  cycleRef,
  fillSeries,
  funcContext,
  refsIn,
  type Cells,
} from "@/lib/sheet";

// 엑셀 연습장 — 컴활 2과목(스프레드시트 일반) 문제를 풀다가 수식을 직접 넣어 결과를 확인한다.
// 문제 카드 안(접었다 펴기)과 /bank/excel(넓은 연습장) 두 곳에서 쓴다.
//
// 엑셀처럼 동작하는 것: 수식 입력줄·이름 상자, 수식 입력 중 칸을 누르면 주소 삽입(끌면 범위),
// F4 절대/상대 참조 전환, 채우기 핸들(상대 참조 이동·요일·갑을병정·숫자 증가, 위·왼쪽은 거꾸로),
// Ctrl+C/V(참조 이동), Ctrl+D/R(복사), Ctrl+Z/Y, 상태 표시줄의 평균·개수·합계, 긴 글자는 빈 옆 칸으로 넘침.
// 계산은 src/lib/sheet.ts.
//
// 입력 받는 방식: 선택한 칸 위에 늘 투명한 입력창을 띄워 둔다. 글자를 치면(한글 조합 포함) 그대로
// 편집이 시작된다 — keydown으로 글자를 가로채면 한글 IME 첫 글자가 사라진다.
// 투명 입력창은 편집 중이 아니면 pointer-events를 끈다 — 안 끄면 모바일에서 칸을 탭할 때마다
// 입력창이 눌려 가상 키보드가 올라온다.

type Pos = { r: number; c: number };
type Rect = { r0: number; c0: number; r1: number; c1: number };
const rectOf = (a: Pos, b: Pos): Rect => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
});
const inRect = (r: number, c: number, x: Rect) => r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1;
const rectName = (x: Rect) =>
  x.r0 === x.r1 && x.c0 === x.c1 ? addr(x.r0, x.c0) : `${addr(x.r0, x.c0)}:${addr(x.r1, x.c1)}`;

// 수식 입력 중 칸 클릭이 "주소 넣기"가 되는 자리 — 연산자·괄호·쉼표 바로 뒤
const POINTABLE = /[=(,+\-*/^&<>:]\s*$/;
const FN_NAMES = Object.keys(FUNCS).sort();
// 선택된 행·열 머리 — 고정(sticky) 칸이라 반투명이면 스크롤된 글자가 비친다. 불투명하게 섞는다
const HEAD_ON = "color-mix(in srgb, var(--blue) 16%, var(--surface))";
const HISTORY = 100;

function setRaw(next: Cells, p: Pos, v: string) {
  const k = addr(p.r, p.c);
  if (v === "") delete next[k];
  else next[k] = v;
}

// 채우기 핸들 — 원본 영역의 줄마다(아래·위로 끌면 각 열, 옆으로 끌면 각 행) fillSeries.
// 위·왼쪽으로 끌면 원본을 끄는 방향 순서로 뒤집어 넘기고 방향도 음수로 — 날짜·요일이 거꾸로 이어진다
function fillCells(prev: Cells, src: Rect, to: Rect): Cells {
  const next = { ...prev };
  const get = (r: number, c: number) => prev[addr(r, c)] ?? "";
  const put = (r: number, c: number, v: string) => setRaw(next, { r, c }, v);
  if (to.r1 > src.r1 || to.r0 < src.r0) {
    const downward = to.r1 > src.r1;
    const count = downward ? to.r1 - src.r1 : src.r0 - to.r0;
    for (let c = src.c0; c <= src.c1; c++) {
      let s: string[] = [];
      for (let r = src.r0; r <= src.r1; r++) s.push(get(r, c));
      if (!downward) s = s.reverse();
      fillSeries(s, count, { dr: downward ? 1 : -1, dc: 0 }).forEach((v, j) =>
        put(downward ? src.r1 + 1 + j : src.r0 - 1 - j, c, v)
      );
    }
  } else {
    const rightward = to.c1 > src.c1;
    const count = rightward ? to.c1 - src.c1 : src.c0 - to.c0;
    for (let r = src.r0; r <= src.r1; r++) {
      let s: string[] = [];
      for (let c = src.c0; c <= src.c1; c++) s.push(get(r, c));
      if (!rightward) s = s.reverse();
      fillSeries(s, count, { dr: 0, dc: rightward ? 1 : -1 }).forEach((v, j) =>
        put(r, rightward ? src.c1 + 1 + j : src.c0 - 1 - j, v)
      );
    }
  }
  return next;
}

// Ctrl+D·Ctrl+R — 채우기 핸들과 달리 연속 데이터가 아니라 **복사**(월 → 월). 수식은 상대 참조만 옮긴다
function copyCells(prev: Cells, src: Rect, to: Rect): Cells {
  const next = { ...prev };
  const h = src.r1 - src.r0 + 1;
  const w = src.c1 - src.c0 + 1;
  for (let r = to.r0; r <= to.r1; r++)
    for (let c = to.c0; c <= to.c1; c++) {
      if (inRect(r, c, src)) continue;
      const sr = src.r0 + ((((r - src.r0) % h) + h) % h);
      const sc = src.c0 + ((((c - src.c0) % w) + w) % w);
      setRaw(next, { r, c }, shiftFormula(prev[addr(sr, sc)] ?? "", r - sr, c - sc));
    }
  return next;
}

function loadCells(key?: string): Cells | null {
  if (!key) return null;
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as Cells) : null;
  } catch {
    return null;
  }
}

export default function ExcelPad({
  rows = 12,
  cols = 8,
  formulas = [],
  storageKey,
  initial,
}: {
  rows?: number;
  cols?: number;
  /** 문제 보기에서 뽑은 수식 — 버튼으로 선택한 칸에 넣는다 */
  formulas?: { label: string; formula: string }[];
  /** 주면 브라우저에 저장해 다시 열어도 남는다 (연습장 페이지) */
  storageKey?: string;
  initial?: Cells;
}) {
  const [cells, setCells] = useState<Cells>(() => initial ?? {});
  // 저장본을 읽기 전엔 저장하지 않는다 — 안 그러면 첫 렌더의 initial(예제)이 저장본을 덮는다
  const [ready, setReady] = useState(!storageKey);
  const [cur, setCur] = useState<Pos>({ r: 0, c: 0 });
  const [sel, setSel] = useState<Rect>({ r0: 0, c0: 0, r1: 0, c1: 0 });
  const [editing, setEditing] = useState(false);
  const [quick, setQuick] = useState(false); // 글자를 쳐서 시작한 편집 — 화살표가 확정+이동
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [fillTo, setFillTo] = useState<Rect | null>(null);
  const [clip, setClip] = useState<{ from: Rect; data: string[][]; tsv: string } | null>(null);

  const cellInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const drag = useRef<null | "select" | "point" | "fill">(null);
  const point = useRef<{ start: number; anchor: Pos } | null>(null);
  const touch = useRef(false);
  const touched = useRef(false); // 한 번이라도 만졌나 — 처음 펼칠 때 포커스를 뺏지 않게
  const past = useRef<Cells[]>([]); // Ctrl+Z
  const future = useRef<Cells[]>([]); // Ctrl+Y

  // 브라우저 저장본 — 첫 렌더 뒤에 읽어 서버 렌더와 어긋나지 않게
  useEffect(() => {
    const saved = loadCells(storageKey);
    /* eslint-disable react-hooks/set-state-in-effect -- 마운트 1회 복원 (localStorage는 렌더 중 못 읽는다) */
    if (saved) setCells(saved);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || !ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(cells));
    } catch {
      /* 저장 못 해도 연습장은 동작한다 */
    }
  }, [cells, storageKey, ready]);

  const sheet = useMemo(() => new Sheet(cells), [cells]);
  const raw = (p: Pos) => cells[addr(p.r, p.c)] ?? "";

  // 시트 바꾸기 — 되돌리기 기록을 남긴다. 한 이벤트에서 두 번 부르지 말 것(두 번째가 첫 번째를 덮는다)
  function change(next: Cells) {
    if (next === cells) return;
    past.current.push(cells);
    if (past.current.length > HISTORY) past.current.shift();
    future.current = [];
    setCells(next);
  }
  function undo() {
    const p = past.current.pop();
    if (!p) return;
    future.current.push(cells);
    setCells(p);
  }
  function redo() {
    const n = future.current.pop();
    if (!n) return;
    past.current.push(cells);
    setCells(n);
  }

  const focusCell = useCallback(() => {
    if (!touch.current && touched.current) cellInput.current?.focus({ preventScroll: true });
  }, []);

  // 칸 위 입력창은 선택한 칸을 따라 새로 그려진다 — 렌더가 끝난 뒤에 포커스·스크롤
  // (칸의 scroll-margin이 고정 머리 높이만큼이라 위·왼쪽으로 가도 머리에 가리지 않는다)
  useEffect(() => {
    if (!touched.current) return;
    cellInput.current?.closest("td")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!editing) focusCell();
  }, [cur, editing, focusCell]);

  function moveTo(p: Pos, extend = false) {
    const q = { r: Math.max(0, Math.min(rows - 1, p.r)), c: Math.max(0, Math.min(cols - 1, p.c)) };
    if (extend) setSel(rectOf(cur, q));
    else {
      setCur(q);
      setSel(rectOf(q, q));
    }
    setMsg(null);
  }

  function startEdit(text: string, isQuick: boolean) {
    setEditing(true);
    setQuick(isQuick);
    setDraft(text);
    point.current = null;
  }

  // 수식 검사 — 엑셀이 입력을 거부하는 수식이면 이유, 아니면 null
  function formulaProblem(v: string): string | null {
    if (v === "=") return "수식이 비어 있어요. = 뒤에 계산할 식을 써 주세요.";
    if (!v.startsWith("=")) return null;
    try {
      parseFormula(v.slice(1));
      return null;
    } catch (e) {
      return e instanceof FormulaError ? e.message : "수식을 이해하지 못했어요.";
    }
  }

  // 확정 — 수식이 깨졌으면 엑셀처럼 확정을 막고 이유를 보여 준다
  function commit(move?: Pos): boolean {
    if (!editing) return true;
    const problem = formulaProblem(draft);
    if (problem) {
      setMsg({ text: `수식에 문제가 있어요: ${problem}`, bad: true });
      return false;
    }
    const next = { ...cells };
    setRaw(next, cur, draft);
    change(next);
    setEditing(false);
    setQuick(false);
    setDraft("");
    point.current = null;
    setMsg(null);
    if (move) moveTo(move);
    focusCell();
    return true;
  }

  function cancel() {
    setEditing(false);
    setQuick(false);
    setDraft("");
    point.current = null;
    setMsg(null);
    focusCell();
  }

  // 수식 입력 중 칸 누르기 → 주소 넣기 (끌면 범위)
  function pointable() {
    return editing && draft.startsWith("=") && (point.current !== null || POINTABLE.test(draft));
  }
  function putRef(a: Pos, b: Pos) {
    const ref = rectName(rectOf(a, b));
    setDraft((d) => {
      const start = point.current?.start ?? d.length;
      point.current = { start, anchor: a };
      return d.slice(0, start) + ref;
    });
  }

  function cellAt(x: number, y: number): Pos | null {
    const el = document.elementFromPoint(x, y)?.closest("[data-cell]") as HTMLElement | null;
    return el ? { r: Number(el.dataset.r), c: Number(el.dataset.c) } : null;
  }

  function onCellDown(e: React.PointerEvent, p: Pos) {
    touch.current = e.pointerType === "touch";
    touched.current = true;
    if (pointable()) {
      e.preventDefault(); // 입력창 포커스 유지
      putRef(p, p);
      drag.current = "point";
      return;
    }
    if (editing && !commit()) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey) setSel(rectOf(cur, p));
    else {
      setCur(p);
      setSel(rectOf(p, p));
      setMsg(null);
    }
    if (!touch.current) {
      drag.current = "select";
      e.preventDefault(); // 글자 선택 막기 — 포커스는 위 effect가 새 칸의 입력창에 준다
      if (p.r === cur.r && p.c === cur.c) focusCell();
    }
  }

  // 채우기 핸들을 p 칸까지 끌었을 때 채울 영역 — 선택 영역 밖으로 더 멀리 나간 축 하나만
  const fillTarget = useCallback((p: Pos): Rect | null => {
    const down = p.r > sel.r1 ? p.r - sel.r1 : 0;
    const up = p.r < sel.r0 ? sel.r0 - p.r : 0;
    const right = p.c > sel.c1 ? p.c - sel.c1 : 0;
    const left = p.c < sel.c0 ? sel.c0 - p.c : 0;
    const m = Math.max(down, up, right, left);
    if (m === 0) return null;
    if (m === down) return { ...sel, r1: p.r };
    if (m === up) return { ...sel, r0: p.r };
    if (m === right) return { ...sel, c1: p.c };
    return { ...sel, c0: p.c };
  }, [sel]);

  function onGridMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = cellAt(e.clientX, e.clientY);
    if (!p) return;
    if (drag.current === "select") setSel(rectOf(cur, p));
    else if (drag.current === "point" && point.current) putRef(point.current.anchor, p);
    else if (drag.current === "fill") setFillTo(fillTarget(p));
  }

  // 끌기 끝 — 시트 밖에서 손을 떼도 잡히게 window에서 듣는다.
  // 채울 영역은 손을 뗀 **좌표로 다시 계산**한다 — 마지막 이동 뒤 화면이 다시 그려지기 전에 떼면
  // fillTo 상태가 한 박자 늦어 아무것도 안 채워졌다 (빠르게 휙 끌 때)
  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (drag.current === "fill") {
        // pointercancel = 브라우저가 스크롤 등으로 가져감 — 채우지 않는다
        const p = e.type === "pointerup" ? cellAt(e.clientX, e.clientY) : null;
        const to = p ? fillTarget(p) : null;
        if (to) {
          past.current.push(cells);
          if (past.current.length > HISTORY) past.current.shift();
          future.current = [];
          setCells(fillCells(cells, sel, to));
          setSel(to);
        }
        setFillTo(null);
      }
      drag.current = null;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [fillTarget, sel, cells]);

  function clearSel() {
    const next = { ...cells };
    for (let r = sel.r0; r <= sel.r1; r++) for (let c = sel.c0; c <= sel.c1; c++) delete next[addr(r, c)];
    change(next);
  }

  function copySel() {
    const data: string[][] = [];
    for (let r = sel.r0; r <= sel.r1; r++) {
      const row: string[] = [];
      for (let c = sel.c0; c <= sel.c1; c++) row.push(cells[addr(r, c)] ?? "");
      data.push(row);
    }
    const tsv = data.map((row) => row.join("\t")).join("\n");
    setClip({ from: sel, data, tsv });
    navigator.clipboard?.writeText(tsv).catch(() => {});
    setMsg({ text: `${rectName(sel)} 복사 — 붙여 넣을 칸을 고르고 Ctrl+V` });
  }

  // 붙여넣기 — 연습장에서 복사한 것이면 수식 참조를 옮겨 붙이고, 밖(엑셀·메모장)에서 온 표면 값 그대로
  function pasteText(text: string) {
    const internal = clip && clip.tsv === text.replace(/\r/g, "").replace(/\n$/, "");
    const data = internal ? clip.data : text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const dr = internal ? cur.r - clip.from.r0 : 0;
    const dc = internal ? cur.c - clip.from.c0 : 0;
    const next = { ...cells };
    data.forEach((row, i) =>
      row.forEach((v, j) => {
        const r = cur.r + i;
        const c = cur.c + j;
        if (r < rows && c < cols) setRaw(next, { r, c }, internal ? shiftFormula(v, dr, dc) : v);
      })
    );
    change(next);
    setSel({ r0: cur.r, c0: cur.c, r1: Math.min(rows - 1, cur.r + data.length - 1), c1: Math.min(cols - 1, cur.c + (data[0]?.length ?? 1) - 1) });
  }

  // Ctrl+D(아래로)·Ctrl+R(오른쪽으로) — 범위면 첫 행(열)을 나머지에, 한 칸이면 위(왼쪽) 칸을 그 칸에 복사
  function copyFill(down: boolean) {
    if (down) {
      if (sel.r1 > sel.r0) change(copyCells(cells, { ...sel, r1: sel.r0 }, sel));
      else if (sel.r0 > 0) change(copyCells(cells, { ...sel, r0: sel.r0 - 1, r1: sel.r0 - 1 }, { ...sel, r0: sel.r0 - 1 }));
    } else {
      if (sel.c1 > sel.c0) change(copyCells(cells, { ...sel, c1: sel.c0 }, sel));
      else if (sel.c0 > 0) change(copyCells(cells, { ...sel, c0: sel.c0 - 1, c1: sel.c0 - 1 }, { ...sel, c0: sel.c0 - 1 }));
    }
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>, from: "cell" | "bar") {
    touched.current = true;
    if (e.nativeEvent.isComposing || e.key === "Process") return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // Ctrl+R(새로고침)·Ctrl+D(북마크)는 연습장 안에선 언제나 막는다 — CBT 답안이 날아간다
    if (mod && (k === "r" || k === "d")) e.preventDefault();
    if (editing) {
      if (e.key === "Enter") {
        e.preventDefault();
        commit({ r: cur.r + (e.shiftKey ? -1 : 1), c: cur.c });
      } else if (e.key === "Tab") {
        e.preventDefault();
        commit({ r: cur.r, c: cur.c + (e.shiftKey ? -1 : 1) });
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "F4") {
        e.preventDefault();
        const el = e.currentTarget;
        const res = cycleRef(draft, el.selectionStart ?? draft.length);
        if (res) {
          setDraft(res.text);
          point.current = null;
          requestAnimationFrame(() => el.setSelectionRange(res.caret, res.caret));
        }
      } else if (quick && from === "cell" && !draft.startsWith("=") && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] ?? [0, 0];
        commit({ r: cur.r + d[0], c: cur.c + d[1] });
      }
      return;
    }
    // 편집 중이 아닐 때 (칸 위 투명 입력창)
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dr, dc] = arrows[e.key];
      if (e.shiftKey) {
        const end = { r: cur.r === sel.r0 ? sel.r1 : sel.r0, c: cur.c === sel.c0 ? sel.c1 : sel.c0 };
        moveTo({ r: end.r + dr, c: end.c + dc }, true);
      } else moveTo({ r: cur.r + dr, c: cur.c + dc });
    } else if (e.key === "Enter") {
      e.preventDefault();
      moveTo({ r: cur.r + (e.shiftKey ? -1 : 1), c: cur.c });
    } else if (e.key === "Tab") {
      e.preventDefault();
      moveTo({ r: cur.r, c: cur.c + (e.shiftKey ? -1 : 1) });
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearSel();
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit(raw(cur), false);
    } else if (mod && k === "c") {
      e.preventDefault();
      copySel();
    } else if (mod && k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && k === "d") copyFill(true);
    else if (mod && k === "r") copyFill(false);
  }

  function onCellInput(v: string) {
    point.current = null;
    if (!editing) startEdit(v, true);
    else setDraft(v);
  }

  function insertFormula(f: string) {
    // 엑셀이 입력을 거부하는 보기(괄호가 안 맞는 오답 보기 등)는 넣지 않고 이유를 보여 준다
    const problem = formulaProblem(f);
    if (problem) {
      setMsg({ text: `이 수식은 엑셀에서 입력되지 않아요 — ${problem}`, bad: true });
      return;
    }
    // 편집 중이던 내용은 버리고 보기 수식으로 바꾼다 (같은 이벤트에서 change를 두 번 부르지 않게)
    setEditing(false);
    setQuick(false);
    setDraft("");
    point.current = null;
    const next = { ...cells };
    setRaw(next, cur, f);
    change(next);
    setMsg({ text: `${addr(cur.r, cur.c)}에 넣었어요. 수식이 가리키는 칸에 문제의 값을 채워 결과를 확인해 보세요.` });
    focusCell();
  }

  // 함수 이름 자동 완성 — "=VL" → VLOOKUP(
  const fnPrefix = editing && draft.startsWith("=") ? (draft.match(/(?:^=|[=(,+\-*/^&<>:]\s*)([A-Za-z][A-Za-z.]*)$/) ?? [])[1] : undefined;
  const suggestions = fnPrefix ? FN_NAMES.filter((n) => n.startsWith(fnPrefix.toUpperCase()) && n !== fnPrefix.toUpperCase()).slice(0, 6) : [];
  const ctx = editing && draft.startsWith("=") ? funcContext(draft) : null;
  const help = ctx && FUNC_HELP[ctx.name];
  const refs = editing ? refsIn(draft) : [];

  // 상태 표시줄 — 선택 영역의 평균·개수·합계 (엑셀 아래쪽 막대와 같다)
  const stats = useMemo(() => {
    if (sel.r0 === sel.r1 && sel.c0 === sel.c1) return null;
    let count = 0;
    const nums: number[] = [];
    for (let r = sel.r0; r <= sel.r1; r++)
      for (let c = sel.c0; c <= sel.c1; c++) {
        const v = sheet.value(r, c);
        if (v !== null && v !== "") count++;
        if (typeof v === "number") nums.push(v);
      }
    if (!count) return null;
    const sum = nums.reduce((s, x) => s + x, 0);
    return { count, sum, avg: nums.length ? sum / nums.length : null };
  }, [sel, sheet]);

  const curDisp = sheet.display(cur.r, cur.c);
  const shown = editing ? draft : raw(cur);
  const markTouch = (e: React.PointerEvent) => {
    touch.current = e.pointerType === "touch";
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-2.5 min-w-0 w-full max-w-full">
      {formulas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-bold text-sub mr-0.5">보기 수식 넣기</span>
          {formulas.map((f) => (
            <button
              key={f.label + f.formula}
              type="button"
              onPointerDown={markTouch}
              onClick={() => {
                touched.current = true;
                insertFormula(f.formula);
              }}
              className="chip !text-[12px] !py-1 max-w-full truncate"
              title={f.formula}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* 이름 상자 + 수식 입력줄 */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 w-[72px] h-10 rounded-[8px] border border-line grid place-items-center text-[14px] font-bold tabular-nums" style={{ background: "var(--fill-2)" }}>
          {rectName(sel)}
        </span>
        <span className="shrink-0 text-[14px] italic font-bold text-sub">fx</span>
        <input
          ref={barInput}
          value={shown}
          onFocus={() => {
            touched.current = true;
            if (!editing) startEdit(raw(cur), false);
          }}
          onChange={(e) => {
            point.current = null;
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => onKey(e, "bar")}
          onBlur={() => {
            // 칸·버튼을 누른 게 아니라 바깥을 눌렀으면 확정
            setTimeout(() => {
              const a = document.activeElement;
              if (a !== cellInput.current && a !== barInput.current && editing) commit();
            }, 0);
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="수식 입력줄"
          placeholder="값이나 =수식 입력"
          className="flex-1 min-w-0 h-10 px-3.5 rounded-[8px] border border-line text-[14px] outline-none bg-[var(--surface)] font-mono focus:border-[var(--blue)]"
        />
      </div>

      {/* 안내 줄 — 높이를 고정한다. 수식을 치는 동안 도움말이 생겼다 사라지며 시트를 밀면
          누르려던 칸이 움직여 엉뚱한 주소가 들어간다. 한 번에 하나만: 오류 > 자동 완성 > 함수 도움말 > 칸 오류 */}
      <div className="h-[38px] overflow-hidden text-[12.5px] leading-[19px] flex items-center">
        {msg ? (
          <p style={{ color: msg.bad ? "var(--red)" : "var(--text-2)" }} className={`line-clamp-2 ${msg.bad ? "font-bold" : ""}`}>
            {msg.text}
          </p>
        ) : suggestions.length > 0 ? (
          <div className="flex gap-1 overflow-x-auto">
            {suggestions.map((n) => (
              <button
                key={n}
                type="button"
                onPointerDown={markTouch}
                onClick={() => {
                  setDraft((d) => d.slice(0, d.length - (fnPrefix?.length ?? 0)) + n + "(");
                  point.current = null;
                }}
                className="chip !text-[12px] !py-0.5 font-mono shrink-0"
              >
                {n}
              </button>
            ))}
          </div>
        ) : help ? (
          <FuncHelp help={help} arg={ctx!.arg} />
        ) : !editing && curDisp.error ? (
          <p className="line-clamp-2" style={{ color: "var(--red)" }}>
            {curDisp.text.startsWith("#") && <b>{curDisp.text} </b>}
            {curDisp.error}
          </p>
        ) : (
          <p className="text-sub truncate">
            {editing ? "Enter로 확정 · Esc로 취소 · 수식 중에 칸을 누르면 주소가 들어가요" : "칸을 고르고 바로 입력하세요. 수식은 = 로 시작해요"}
          </p>
        )}
      </div>

      {/* 시트 */}
      <div
        className="overflow-auto max-w-full rounded-[10px] border border-line select-none max-h-[420px]"
        style={{ background: "var(--surface)", overscrollBehavior: "contain" }}
        onPointerMove={onGridMove}
        onPaste={(e) => {
          if (editing) return;
          e.preventDefault();
          pasteText(e.clipboardData.getData("text/plain"));
        }}
      >
        {/* 넓은 화면에선 열이 늘어나 폭을 채우고, 좁은 화면에선 열마다 84px 아래로는 줄지 않고 가로 스크롤 */}
        <table className="w-full border-collapse text-[13px] tabular-nums" style={{ tableLayout: "fixed", minWidth: 36 + cols * 84 }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {Array.from({ length: cols }, (_, c) => (
              <col key={c} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 border-b border-r border-line" style={{ background: "var(--fill)" }} />
              {Array.from({ length: cols }, (_, c) => (
                <th
                  key={c}
                  className="sticky top-0 z-10 h-[24px] border-b border-r border-line text-[12px] font-semibold"
                  style={{
                    background: c >= sel.c0 && c <= sel.c1 ? HEAD_ON : "var(--fill)",
                    color: c >= sel.c0 && c <= sel.c1 ? "var(--blue)" : "var(--sub)",
                  }}
                >
                  {colName(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                <th
                  className="sticky left-0 z-10 h-[28px] border-b border-r border-line text-[12px] font-semibold"
                  style={{
                    background: r >= sel.r0 && r <= sel.r1 ? HEAD_ON : "var(--fill)",
                    color: r >= sel.r0 && r <= sel.r1 ? "var(--blue)" : "var(--sub)",
                  }}
                >
                  {r + 1}
                </th>
                {Array.from({ length: cols }, (_, c) => {
                  const isCur = r === cur.r && c === cur.c;
                  const d = isCur && editing ? null : sheet.display(r, c);
                  const inSel = inRect(r, c, sel) && !(sel.r0 === sel.r1 && sel.c0 === sel.c1);
                  const inFill = fillTo && inRect(r, c, fillTo) && !inRect(r, c, sel);
                  const isRef = refs.some((x) => inRect(r, c, x));
                  const isFillCorner = !editing && r === sel.r1 && c === sel.c1;
                  // 긴 글자는 엑셀처럼 오른쪽 빈 칸들로 넘쳐 보인다 (내용 있는 칸 앞에서 멈춤)
                  let spill = 0;
                  if (d && d.align === "left" && d.text)
                    while (c + spill + 1 < cols && !cells[addr(r, c + spill + 1)] && !(editing && cur.r === r && cur.c === c + spill + 1)) spill++;
                  return (
                    <td
                      key={c}
                      data-cell
                      data-r={r}
                      data-c={c}
                      onPointerDown={(e) => onCellDown(e, { r, c })}
                      onDoubleClick={() => {
                        if (!editing) {
                          startEdit(raw({ r, c }), false);
                          requestAnimationFrame(() => cellInput.current?.focus());
                        }
                      }}
                      className="relative h-[28px] p-0 border-b border-r border-line cursor-cell"
                      style={{
                        background: isRef ? "rgba(240, 160, 40, 0.16)" : inFill ? "var(--fill)" : inSel ? "var(--blue-weak)" : undefined,
                        outline: isCur ? "2px solid var(--blue)" : inFill ? "1px dashed var(--sub)" : undefined,
                        outlineOffset: -2,
                        scrollMarginTop: 26, // 고정 열 머리 높이
                        scrollMarginLeft: 38, // 고정 행 머리 폭
                      }}
                    >
                      {isCur ? (
                        <input
                          ref={cellInput}
                          value={editing ? draft : ""}
                          onChange={(e) => onCellInput(e.target.value)}
                          onKeyDown={(e) => onKey(e, "cell")}
                          onBlur={() => {
                            setTimeout(() => {
                              const a = document.activeElement;
                              if (a !== cellInput.current && a !== barInput.current && editing) commit();
                            }, 0);
                          }}
                          onPaste={(e) => {
                            if (editing) return;
                            e.preventDefault();
                            pasteText(e.clipboardData.getData("text/plain"));
                          }}
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          aria-label={`${addr(r, c)} 칸`}
                          className="absolute inset-0 w-full h-full px-1.5 text-[13px] outline-none font-mono"
                          style={
                            editing
                              ? { background: "var(--surface)", zIndex: 5 }
                              : { opacity: 0, caretColor: "transparent", pointerEvents: "none" }
                          }
                        />
                      ) : null}
                      {d?.text ? (
                        <div
                          className="h-full px-1.5 leading-[27px] whitespace-nowrap overflow-hidden"
                          style={{
                            textAlign: d.align,
                            color: d.error ? "var(--red)" : undefined,
                            textOverflow: spill ? "clip" : "ellipsis",
                            ...(spill ? { position: "relative", zIndex: 1, width: `calc(${spill + 1} * 100%)`, pointerEvents: "none" } : {}),
                          }}
                        >
                          {d.text}
                        </div>
                      ) : null}
                      {isFillCorner && (
                        // 손잡이는 9px지만 누르는 자리는 20px — 손가락으로도 잡히게. touch-action:none이라 끌어도 화면이 안 밀린다
                        <span
                          aria-label="채우기 핸들"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            touch.current = e.pointerType === "touch";
                            touched.current = true;
                            drag.current = "fill";
                          }}
                          className="absolute right-[-10px] bottom-[-10px] w-[20px] h-[20px] z-[6] grid place-items-center cursor-crosshair"
                          style={{ touchAction: "none" }}
                        >
                          <span className="block w-[9px] h-[9px]" style={{ background: "var(--blue)", border: "1.5px solid var(--surface)" }} />
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 상태 표시줄 + 도구 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-[13px] text-sub">
        <span className="tabular-nums flex gap-3 order-last" data-status>
          {stats ? (
            <>
              {stats.avg !== null && <span>평균: {fmtNum(stats.avg)}</span>}
              <span>개수: {stats.count}</span>
              {stats.avg !== null && <span>합계: {fmtNum(stats.sum)}</span>}
            </>
          ) : (
            "칸을 끌어 범위를 고르면 평균·개수·합계가 보여요"
          )}
        </span>
        <span className="flex flex-wrap gap-1.5">
          <button type="button" onClick={undo} className="btn btn-gray h-9 px-3 !rounded-[8px] text-[13px] !font-semibold" title="Ctrl+Z">
            되돌리기
          </button>
          <button type="button" onClick={copySel} className="btn btn-gray h-9 px-3 !rounded-[8px] text-[13px] !font-semibold">
            복사
          </button>
          {clip && (
            <button type="button" onClick={() => pasteText(clip.tsv)} className="btn btn-gray h-9 px-3 !rounded-[8px] text-[13px] !font-semibold">
              붙여넣기
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (Object.keys(cells).length && !confirm("시트를 모두 지울까요?")) return;
              change({});
              cancel();
            }}
            className="btn btn-gray h-9 px-3 !rounded-[8px] text-[13px] !font-semibold"
          >
            모두 지우기
          </button>
        </span>
      </div>
    </div>
  );
}

const fmtNum = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : Number(n.toPrecision(10)).toLocaleString(undefined, { maximumFractionDigits: 6 }));

// 함수 도움말 — 지금 입력 중인 인수를 굵게
function FuncHelp({ help, arg }: { help: string; arg: number }) {
  const m = help.match(/^([^(]+)\((.*?)\)(.*)$/);
  if (!m) return <p className="text-sub">{help}</p>;
  const params = m[2].split(/,\s*/);
  const at = Math.min(arg, params.length - 1);
  return (
    <p className="font-mono text-[12px] line-clamp-2" style={{ color: "var(--text-2)" }}>
      <b>{m[1]}</b>(
      {params.map((p, i) => (
        <span key={i}>
          {i > 0 && ", "}
          <span style={i === at ? { color: "var(--blue)", fontWeight: 800, textDecoration: "underline" } : undefined}>{p}</span>
        </span>
      ))}
      )<span className="font-sans text-sub">{m[3]}</span>
    </p>
  );
}

// "=" 다음 수식 한 덩어리 — ⇒·→ 또는 괄호 밖의 한글(설명 문장)이 나오면 끝
function formulaHead(s: string): string | null {
  if (!s.startsWith("=")) return null;
  let depth = 0;
  let inStr = false;
  let end = s.length;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "⇒" || ch === "→" || (ch === "=" && s[i + 1] === ">") || (depth <= 0 && /[가-힣]/.test(ch) && /\s/.test(s[i - 1] ?? ""))) {
      end = i;
      break;
    }
  }
  const f = s.slice(0, end).trim();
  return /^=\s*[A-Za-z$(\d"-]/.test(f) ? f : null;
}

// 문제(지문·보기)에서 연습장 버튼으로 넣을 수식 뽑기 — "=MOD(13,-3) ⇒ -2" → "=MOD(13,-3)"
export function formulasFrom(stem: string, choices: string[] | null | undefined): { label: string; formula: string }[] {
  const out: { label: string; formula: string }[] = [];
  const marks = ["①", "②", "③", "④", "⑤"];
  const clean = (s: string) =>
    s
      .replace(/\[\[그림\]\]\S+/g, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  (choices ?? []).forEach((c, i) => {
    const f = formulaHead(clean(c));
    if (f) out.push({ label: `${marks[i] ?? i + 1} ${f}`, formula: f });
  });
  // 지문 속 수식 — "[D2] 셀에 =IF(…)를 입력하고" 같은 꼴. 괄호 짝이 맞는 데까지
  const s = clean(stem);
  for (const m of s.matchAll(/=\s*[A-Z][A-Z0-9.]*\(/g)) {
    let depth = 0;
    let end = -1;
    let inStr = false;
    for (let i = m.index! + m[0].length - 1; i < s.length; i++) {
      if (s[i] === '"') inStr = !inStr;
      if (inStr) continue;
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end > 0) {
      const f = s.slice(m.index, end).replace(/^=\s*/, "=");
      if (!out.some((o) => o.formula === f)) out.push({ label: `지문 ${f}`, formula: f });
    }
  }
  return out.slice(0, 6);
}

// 컴활 2과목(스프레드시트 일반) 문항 아래 "엑셀로 직접 해보기" — 누르면 연습장이 펼쳐진다.
// 다른 영역 문항에선 아무것도 그리지 않는다. 문제마다 시트는 따로(접었다 펴면 비워진다).
export const SPREADSHEET_AREA = "스프레드시트 일반";

export function ExcelTry({ area, stem, choices }: { area?: string | null; stem: string; choices?: string[] | null }) {
  const [open, setOpen] = useState(false);
  if (area !== SPREADSHEET_AREA) return null;
  const formulas = open ? formulasFrom(stem, choices) : [];
  return (
    <div className="rounded-[12px] border border-line flex flex-col min-w-0" style={{ background: "var(--fill-2)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <svg aria-hidden width="22" height="22" viewBox="0 0 22 22" className="shrink-0" style={{ color: "var(--blue)" }}>
            <rect x="1.5" y="1.5" width="19" height="19" rx="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M1.5 8h19M1.5 14.5h19M8.5 1.5v19" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span className="font-bold text-[14px]">엑셀로 직접 해보기</span>
        </span>
        <span className="text-sub text-[12px] shrink-0">{open ? "접기" : "펼치기"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 lg:px-4 lg:pb-4 flex flex-col gap-2 min-w-0">
          <p className="text-[12px] text-sub leading-relaxed">
            문제의 표를 칸에 옮겨 적고 수식을 넣어 보세요. 수식은 <b>=</b>로 시작하고, 수식을 입력하는 중에 칸을 누르면 주소가
            들어가요. <b>F4</b>로 $(절대 참조)를 바꿀 수 있어요.
          </p>
          <ExcelPad formulas={formulas} />
        </div>
      )}
    </div>
  );
}
