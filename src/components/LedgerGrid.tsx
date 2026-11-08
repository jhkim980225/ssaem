"use client";
import { useEffect, useRef, useState } from "react";
import { ACCOUNTS, SALES_TYPES, findAccounts, type Entry, type Line } from "@/lib/ledger";

// 실무 연습(/bank/practice)의 전표 입력판 — KcLep 일반전표·매입매출전표 입력 흐름을 웹으로 옮겼다.
// 화면은 이 앱 디자인(카드·칩)이고, 손에 익어야 하는 건 "입력 순서"라 그쪽을 맞췄다:
//   일 → 구분(1출금 2입금 3차변 4대변) → 계정코드(3자리 또는 글자 → 코드 도움) → 거래처 → 적요 → 금액 → 다음 줄
// 1출금/2입금은 KcLep처럼 현금 반대쪽 줄을 따로 안 친다 — 화면에만 "현금"으로 보이고 채점용 Entry에서 줄이 붙는다.
// 매입매출은 위쪽 칸(유형·공급가액·부가세·거래처·전자·분개)을 먼저 치고, 분개 유형대로 아래 줄이 깔린다.
//
// 상태는 부모(page)가 쥔다(value/onChange) — 채점·다시 풀기가 부모에서 일어나서.

export type Kind = "" | "1" | "2" | "3" | "4";
export const KIND_LABEL: Record<Exclude<Kind, "">, string> = { "1": "출금", "2": "입금", "3": "차변", "4": "대변" };
const MODE_LABEL: Record<string, string> = { "1": "현금", "2": "외상", "3": "혼합", "4": "카드" };

export type Row = { kind: Kind; code: string; account: string; partner: string; memo: string; amount: string };
export type SalesForm = {
  type: string;
  supply: string;
  vat: string;
  vatTouched: boolean; // 부가세를 직접 고쳤으면 공급가액을 바꿔도 10%로 덮지 않는다
  partner: string;
  elec: "" | "1" | "0";
  mode: "" | "1" | "2" | "3" | "4";
};
export type LedgerForm = { day: string; header: SalesForm; rows: Row[] };

const emptyRow = (kind: Kind = ""): Row => ({ kind, code: "", account: "", partner: "", memo: "", amount: "" });
export function initialForm(day = ""): LedgerForm {
  return {
    day,
    header: { type: "", supply: "", vat: "", vatTouched: false, partner: "", elec: "", mode: "" },
    rows: [emptyRow()],
  };
}

const digits = (s: string) => s.replace(/\+/g, "000").replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
const num = (s: string) => Number(s || 0);
const comma = (s: string) => (s ? Number(s).toLocaleString("ko-KR") : "");
const pad2 = (s: string) => (s ? s.padStart(2, "0") : "");

// 영세·면세·수출 계열은 부가세 0 — 그 밖(과세·카과·현과·불공·수입·건별)은 공급가액의 10%(원 미만 절사)
const ZERO_VAT = /영세|면세|수출|카면|현면|카영|현영/;
export function zeroVat(typeCode: string): boolean {
  const t = SALES_TYPES.find((s) => s.code === typeCode);
  return !!t && ZERO_VAT.test(t.name);
}
const accountByName = (name: string) => ACCOUNTS.find((a) => a.name === name);

// 1출금 = 대변 현금 / 2입금 = 차변 현금이 숨은 짝 줄
function linesOf(r: Row): Line[] {
  const amount = num(r.amount);
  const account = r.account.trim();
  if (!account || !amount || !r.kind) return [];
  const partner = r.partner.trim() || undefined;
  if (r.kind === "1") return [{ side: "차", account, partner, amount }, { side: "대", account: "현금", amount }];
  if (r.kind === "2") return [{ side: "대", account, partner, amount }, { side: "차", account: "현금", amount }];
  return [{ side: r.kind === "3" ? "차" : "대", account, partner, amount }];
}

// 합계는 계정을 아직 안 골랐어도 금액만 있으면 센다 (KcLep도 금액 기준 — 입력 중 차액이 엉뚱하게 튀지 않게)
export function totals(rows: Row[]) {
  let dr = 0;
  let cr = 0;
  for (const r of rows) {
    const a = num(r.amount);
    if (!r.kind || !a) continue;
    if (r.kind === "1" || r.kind === "2") {
      dr += a; // 숨은 현금 줄이 반대쪽에 같은 금액 — 대차는 늘 맞는다
      cr += a;
    } else if (r.kind === "3") dr += a;
    else cr += a;
  }
  return { dr, cr, diff: dr - cr };
}

/** 화면 입력 → 채점용 Entry */
export function toEntry(f: LedgerForm, month: string, sales: boolean): Entry {
  const date = month && f.day ? `${pad2(month)}-${pad2(f.day)}` : undefined;
  const lines = f.rows.flatMap(linesOf);
  if (!sales) return { date, lines };
  const h = f.header;
  return {
    date,
    lines,
    header: {
      type: h.type,
      supply: num(h.supply),
      vat: num(h.vat),
      partner: h.partner.trim() || undefined,
      electronic: h.elec === "" ? undefined : h.elec === "1",
    },
  };
}

// 매입매출 분개 유형(1현금 2외상 3혼합 4카드)대로 아래 줄을 깐다. 매출·매입 계정(상품매출·원재료 등)은
// 문제마다 달라 비워 둔다 — 학생이 채울 칸. 불공(54)은 부가세가 원가로 들어가 부가세대급금 줄이 없다.
function autoRows(h: SalesForm): Row[] {
  const t = SALES_TYPES.find((s) => s.code === h.type);
  const sale = t?.kind !== "매입";
  const supply = num(h.supply);
  const vat = num(h.vat);
  const noDeduct = !sale && /불공/.test(t?.name ?? "");
  const total = supply + vat;
  const mk = (kind: Kind, name: string, amount: number, partner = ""): Row => ({
    kind,
    code: name ? (accountByName(name)?.code ?? "") : "",
    account: name,
    partner,
    memo: "",
    amount: amount ? String(amount) : "",
  });
  const vatName = sale ? "부가세예수금" : "부가세대급금";
  const body = (kind: Kind): Row[] =>
    noDeduct ? [mk(kind, "", total)] : [...(vat ? [mk(kind, vatName, vat)] : []), mk(kind, "", supply)];
  const p = h.partner.trim();
  switch (h.mode) {
    case "1":
      return body(sale ? "2" : "1");
    case "2":
      return sale ? [mk("3", "외상매출금", total, p), ...body("4")] : [...body("3"), mk("4", "외상매입금", total, p)];
    case "4":
      return sale ? [mk("3", "외상매출금", total, p), ...body("4")] : [...body("3"), mk("4", "미지급금", total, p)];
    default:
      return sale ? body("4") : body("3");
  }
}

type Col = "day" | "kind" | "code" | "partner" | "memo" | "amt";
type HCol = "hday" | "type" | "supply" | "vat" | "hpartner" | "elec" | "mode";
type Popup = { kind: "account"; row: number; q: string; sel: number } | { kind: "type"; q: string; sel: number };

const CELL =
  "w-full h-10 px-2 rounded-[8px] border text-[14px] outline-none transition-colors bg-[var(--surface)] border-[var(--border)] focus:border-[var(--blue)] focus:shadow-[0_0_0_3px_rgba(30,58,95,0.12)] read-only:bg-[var(--fill-2)] read-only:text-[var(--sub)]";
const LABEL_M = "text-[11px] font-semibold text-sub md:sr-only"; // 폰(카드형)에서만 보이는 칸 이름
// PC 표 열 — 일 | 구분 | 코드 | 계정과목 | 거래처 | 적요 | 차변 | 대변 | 삭제
const COLS_MD = "md:grid-cols-[52px_92px_70px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_118px_118px_36px]";

export default function LedgerGrid({
  value,
  onChange,
  month,
  sales,
  lockDay,
}: {
  value: LedgerForm;
  onChange: (f: LedgerForm) => void;
  month: string; // 문제에서 읽은 월 ("" = 못 읽음 — 학생이 일만 친다)
  sales: boolean; // 매입매출전표 — 위쪽 칸 표시
  lockDay?: boolean; // 결산 — 12월 31일 고정
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const { rows, header: h } = value;
  const { dr, cr, diff } = totals(rows);

  // 칸은 data-cell="줄:열"로 찾는다. setState 직후엔 새 칸(새 줄)이 아직 DOM에 없다 — 그린 뒤에 포커스한다
  const cell = (k: string) => rootRef.current?.querySelector<HTMLInputElement>(`[data-cell="${k}"]`) ?? null;
  useEffect(() => {
    const k = pendingFocus.current;
    if (!k) return;
    pendingFocus.current = null;
    const el = cell(k);
    el?.focus();
    el?.select();
  });
  const focus = (k: string) => {
    const el = cell(k);
    if (!el) pendingFocus.current = k;
    else {
      el.focus();
      el.select();
    }
  };
  // 같은 핸들러에서 setState를 부르는 경우 전용 — 줄이 새로 생기거나 값이 바뀐 칸을 그린 뒤 선택한다.
  // (setState 없이 미루면 다음 아무 렌더에서 엉뚱하게 포커스를 뺏는다)
  const focusAfter = (k: string) => {
    pendingFocus.current = k;
  };

  const setRows = (next: Row[], extra?: Partial<LedgerForm>) => onChange({ ...value, ...extra, rows: next });
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setHeader = (patch: Partial<SalesForm>) => {
    const nh = { ...h, ...patch };
    // 공급가액·유형이 바뀌면 부가세 자동 계산 (직접 고친 뒤엔 그대로 둔다)
    if (!nh.vatTouched && ("supply" in patch || "type" in patch))
      nh.vat = nh.supply && nh.type && !zeroVat(nh.type) ? String(Math.floor(num(nh.supply) / 10)) : nh.type && zeroVat(nh.type) ? "0" : nh.vat;
    onChange({ ...value, header: nh });
  };

  const amtSide = (r: Row) => (r.kind === "2" || r.kind === "4" ? "cr" : "dr");

  // 금액 칸에 들어갈 때 비어 있으면 차액을 미리 채운다 (KcLep처럼 — 마지막 줄 금액을 다시 안 쳐도 되게)
  function enterAmount(i: number) {
    const r = rows[i];
    if (!r.amount && (r.kind === "3" || r.kind === "4")) {
      const short = r.kind === "3" ? cr - dr : dr - cr;
      if (short > 0) {
        setRow(i, { amount: String(short) });
        return focusAfter(`${i}:amt`);
      }
    }
    focus(`${i}:amt`);
  }

  function nextFrom(i: number, col: Col) {
    if (col === "day") return focus(`${i}:kind`);
    if (col === "kind") return rows[i].kind ? focus(`${i}:code`) : undefined; // 구분 없이는 못 넘어간다
    if (col === "code") return focus(`${i}:partner`);
    if (col === "partner") return focus(`${i}:memo`);
    if (col === "memo") return enterAmount(i);
    // 금액 → 다음 줄 구분 (없으면 줄 추가). 일은 전표 하나에 하나라 다음 줄은 구분부터
    if (i + 1 < rows.length) return focus(`${i + 1}:kind`);
    setRows([...rows, emptyRow()]);
    focusAfter(`${i + 1}:kind`);
  }

  function pickAccount(i: number, code: string, name: string) {
    setRow(i, { code, account: name });
    setPopup(null);
    focus(`${i}:partner`);
  }

  // 빈 칸에서 F2 = 계정과목표 전체 (KcLep 코드 도움처럼 훑어보며 고른다)
  const accountMatches = popup?.kind === "account" ? (popup.q ? findAccounts(popup.q) : ACCOUNTS) : [];
  const typeMatches =
    popup?.kind === "type"
      ? SALES_TYPES.filter((t) => !popup.q || t.code.startsWith(popup.q) || t.name.includes(popup.q))
      : [];

  function onCodeChange(i: number, text: string) {
    const t = text.trim();
    const exact = /^\d{3}$/.test(t) ? ACCOUNTS.find((a) => a.code === t) : undefined;
    setRow(i, { code: text, account: exact?.name ?? "" });
    // 글자를 치면 바로 코드 도움 — 숫자 3자리가 정확히 맞으면 안 띄운다
    if (t && !exact) setPopup({ kind: "account", row: i, q: t, sel: 0 });
    else setPopup(null);
  }

  function onCodeEnter(i: number) {
    const r = rows[i];
    if (popup?.kind === "account" && popup.row === i) {
      const a = accountMatches[popup.sel];
      if (a) return pickAccount(i, a.code, a.name);
      // 목록에 없는 계정명 — 친 글자 그대로 계정으로 받는다 (계정표가 시험 회사의 추가 계정을 다 담진 못한다)
      if (/\D/.test(r.code.trim())) return pickAccount(i, "", r.code.trim());
      return;
    }
    if (r.account) return nextFrom(i, "code");
    setPopup({ kind: "account", row: i, q: r.code.trim(), sel: 0 });
  }

  function deleteRow(i: number) {
    const next = rows.filter((_, j) => j !== i);
    setRows(next.length ? next : [emptyRow()]);
    setPopup(null);
    focusAfter(`${Math.min(i, Math.max(next.length - 1, 0))}:kind`);
  }

  // 표 칸 공통 키 처리 — Enter 다음 칸, ↑↓ 같은 열 위아래, F5 줄 삭제(KcLep 단축키), F2 코드 도움, Esc 팝업 닫기
  function onCellKey(e: React.KeyboardEvent<HTMLInputElement>, i: number, col: Col) {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter는 글자 확정용
    const open = popup?.kind === "account" && popup.row === i && col === "code";
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = accountMatches.length;
      if (n) setPopup({ ...popup, sel: (popup.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
      return;
    }
    if (e.key === "Escape") return setPopup(null);
    if (e.key === "F2" && col === "code") {
      e.preventDefault();
      return setPopup({ kind: "account", row: i, q: /\D/.test(rows[i].code) ? rows[i].code.trim() : "", sel: 0 });
    }
    if (e.key === "F5") {
      e.preventDefault();
      return deleteRow(i);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const j = i + (e.key === "ArrowDown" ? 1 : -1);
      if (j < 0 || j >= rows.length) return;
      e.preventDefault();
      return focus(`${j}:${col === "day" ? "kind" : col}`);
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (col === "code") return onCodeEnter(i);
    nextFrom(i, col);
  }

  // 매입매출 위쪽 칸 순서
  const H_ORDER: HCol[] = [...(lockDay ? [] : (["hday"] as HCol[])), "type", "supply", "vat", "hpartner", "elec", "mode"];
  function onHeadKey(e: React.KeyboardEvent<HTMLInputElement>, col: HCol) {
    if (e.nativeEvent.isComposing) return;
    if (popup?.kind === "type" && col === "type") {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = typeMatches.length;
        if (n) setPopup({ ...popup, sel: (popup.sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const t = typeMatches[popup.sel];
        if (t) setHeader({ type: t.code });
        // 유형표에 없는 2자리 코드는 친 그대로 받는다 (계정 코드 도움과 같은 이유)
        else if (!/^\d{2}$/.test(h.type)) return;
        setPopup(null);
        focus("h:supply");
        return;
      }
    }
    if (e.key === "Escape") return setPopup(null);
    if (e.key === "F2" && col === "type") {
      e.preventDefault();
      return setPopup({ kind: "type", q: "", sel: 0 });
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (col === "type" && !/^\d{2}$/.test(h.type)) return setPopup({ kind: "type", q: h.type, sel: 0 });
    if (col === "mode") {
      if (!h.mode) return;
      // 분개를 정하면 아래 줄을 새로 깐다 → 비워 둔 계정 칸(매출·매입 계정)으로
      const next = autoRows(h);
      setRows(next.length ? next : [emptyRow()]);
      const blank = next.findIndex((r) => !r.account);
      return focusAfter(blank >= 0 ? `${blank}:code` : "0:kind");
    }
    const k = H_ORDER[H_ORDER.indexOf(col) + 1];
    if (k) focus(`h:${k}`);
  }

  const dayInput = (i: number) =>
    i === 0 && !sales && !lockDay ? (
      <input
        data-cell={`${i}:day`}
        aria-label="일"
        className={`${CELL} text-center tabular-nums`}
        inputMode="numeric"
        enterKeyHint="next"
        maxLength={2}
        value={value.day}
        onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "").slice(0, 2) })}
        onKeyDown={(e) => onCellKey(e, i, "day")}
      />
    ) : (
      <input aria-label="일" readOnly tabIndex={-1} className={`${CELL} text-center tabular-nums`} value={pad2(value.day)} />
    );

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {/* 날짜 줄 — 월은 문제에서 고정, 일은 학생이 친다 */}
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="inline-flex items-center h-8 px-2.5 rounded-[8px] font-bold tabular-nums" style={{ background: "var(--blue-weak)", color: "var(--blue)" }}>
          {month ? `${pad2(month)}월` : "월 미지정"}
        </span>
        <span className="text-sub">
          {lockDay ? "결산일 12월 31일" : sales ? "일은 위쪽 칸에서 입력" : "첫 줄 ‘일’ 칸에 날짜를 입력"}
        </span>
      </div>

      {sales && (
        <fieldset className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 rounded-[12px] p-3" style={{ background: "var(--fill-2)", border: "1px solid var(--border)" }}>
          <legend className="sr-only">매입매출 위쪽 칸</legend>
          {!lockDay && (
            <HeadField label="일">
              <input
                data-cell={"h:hday"}
                className={`${CELL} text-center tabular-nums`}
                inputMode="numeric"
                maxLength={2}
                value={value.day}
                onChange={(e) => onChange({ ...value, day: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                onKeyDown={(e) => onHeadKey(e, "hday")}
              />
            </HeadField>
          )}
          <HeadField label="유형" hint={SALES_TYPES.find((t) => t.code === h.type)?.name ?? "F2 도움"}>
            <div className="relative">
              <input
                data-cell={"h:type"}
                className={`${CELL} tabular-nums`}
                inputMode="numeric"
                maxLength={2}
                value={h.type}
                onChange={(e) => {
                  const t = e.target.value.replace(/\D/g, "");
                  setHeader({ type: t });
                  setPopup(SALES_TYPES.some((s) => s.code === t) ? null : { kind: "type", q: t, sel: 0 });
                }}
                onBlur={() => setPopup((p) => (p?.kind === "type" ? null : p))}
                onKeyDown={(e) => onHeadKey(e, "type")}
              />
              {popup?.kind === "type" && (
                <CodeHelp
                  title="유형 도움"
                  items={typeMatches.map((t) => ({ code: t.code, name: t.name, meta: t.kind }))}
                  sel={popup.sel}
                  onPick={(code) => {
                    setHeader({ type: code });
                    setPopup(null);
                    focus("h:supply");
                  }}
                />
              )}
            </div>
          </HeadField>
          <HeadField label="공급가액">
            <input
              data-cell={"h:supply"}
              className={`${CELL} text-right tabular-nums`}
              inputMode="numeric"
              value={comma(h.supply)}
              onChange={(e) => setHeader({ supply: digits(e.target.value) })}
              onKeyDown={(e) => onHeadKey(e, "supply")}
            />
          </HeadField>
          <HeadField label="부가세">
            <input
              data-cell={"h:vat"}
              className={`${CELL} text-right tabular-nums`}
              inputMode="numeric"
              value={comma(h.vat)}
              onChange={(e) => setHeader({ vat: digits(e.target.value), vatTouched: true })}
              onKeyDown={(e) => onHeadKey(e, "vat")}
            />
          </HeadField>
          <HeadField label="거래처">
            <input
              data-cell={"h:hpartner"}
              className={CELL}
              value={h.partner}
              onChange={(e) => setHeader({ partner: e.target.value })}
              onKeyDown={(e) => onHeadKey(e, "hpartner")}
            />
          </HeadField>
          <HeadField label="전자" hint="1 여 · 0 부">
            <div className="flex items-center gap-1.5">
              <input
                data-cell={"h:elec"}
                className={`${CELL} !w-11 text-center`}
                inputMode="numeric"
                maxLength={1}
                value={h.elec}
                onChange={(e) => {
                  const v = e.target.value.slice(-1);
                  if (v === "" || v === "1" || v === "0") setHeader({ elec: v });
                }}
                onKeyDown={(e) => onHeadKey(e, "elec")}
              />
              <span className="text-[13px] font-semibold">{h.elec === "1" ? "여" : h.elec === "0" ? "부" : ""}</span>
            </div>
          </HeadField>
          <HeadField label="분개" hint="1현금 2외상 3혼합 4카드">
            <div className="flex items-center gap-1.5">
              <input
                data-cell={"h:mode"}
                className={`${CELL} !w-11 text-center`}
                inputMode="numeric"
                maxLength={1}
                value={h.mode}
                onChange={(e) => {
                  const v = e.target.value.slice(-1);
                  if (v === "" || /^[1-4]$/.test(v)) setHeader({ mode: v as SalesForm["mode"] });
                }}
                onKeyDown={(e) => onHeadKey(e, "mode")}
              />
              <span className="text-[13px] font-semibold">{MODE_LABEL[h.mode] ?? ""}</span>
            </div>
          </HeadField>
        </fieldset>
      )}

      {/* 분개 줄 — PC는 표, 폰은 줄마다 카드(같은 입력칸을 배치만 바꾼다 → 키 흐름 공용) */}
      <div role="group" aria-label="분개 입력" className="flex flex-col gap-2 md:gap-1">
        <div aria-hidden="true" className={`hidden md:grid ${COLS_MD} gap-1 px-1 text-[12px] font-bold text-sub`}>
          {["일", "구분", "코드", "계정과목", "거래처", "적요", "차변", "대변", ""].map((t, k) => (
            <span key={k} className={k >= 6 && k < 8 ? "text-right pr-2" : "pl-1"}>
              {t}
            </span>
          ))}
        </div>
        {rows.map((r, i) => {
          const side = amtSide(r);
          const cashOpp = r.kind === "1" || r.kind === "2"; // 숨은 현금 줄 — 반대쪽 칸에 표시만
          return (
            <div
              key={i}
              className={`relative grid grid-cols-6 ${COLS_MD} gap-1.5 md:gap-1 p-3 md:p-0 md:px-1 rounded-[12px] md:rounded-none border md:border-0 border-[var(--border)]`}
            >
              <label className="col-span-2 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>일</span>
                {dayInput(i)}
              </label>
              <label className="col-span-4 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>구분 (1출금 2입금 3차변 4대변)</span>
                <span className="relative block">
                  <input
                    data-cell={`${i}:kind`}
                    aria-label={`${i + 1}번째 줄 구분`}
                    className={`${CELL} pr-11 tabular-nums`}
                    inputMode="numeric"
                    enterKeyHint="next"
                    maxLength={1}
                    value={r.kind}
                    onChange={(e) => {
                      const v = e.target.value.slice(-1);
                      if (v === "" || /^[1-4]$/.test(v)) setRow(i, { kind: v as Kind });
                    }}
                    onKeyDown={(e) => onCellKey(e, i, "kind")}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[12px] font-semibold pointer-events-none" style={{ color: r.kind ? "var(--blue)" : "var(--sub)" }}>
                    {r.kind ? KIND_LABEL[r.kind] : "1~4"}
                  </span>
                </span>
              </label>
              <label className="col-span-2 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>코드 (F2 도움)</span>
                <span className="relative block">
                  <input
                    data-cell={`${i}:code`}
                    aria-label={`${i + 1}번째 줄 계정코드`}
                    className={`${CELL} tabular-nums`}
                    enterKeyHint="next"
                    autoComplete="off"
                    value={r.code}
                    onChange={(e) => onCodeChange(i, e.target.value)}
                    onBlur={() => setPopup((p) => (p?.kind === "account" && p.row === i ? null : p))}
                    onKeyDown={(e) => onCellKey(e, i, "code")}
                  />
                  {popup?.kind === "account" && popup.row === i && (
                    <CodeHelp
                      title="계정 코드 도움"
                      empty={popup.q && /\D/.test(popup.q) ? `목록에 없어요 — Enter로 “${popup.q}” 그대로 입력` : "맞는 계정이 없어요"}
                      items={accountMatches.map((a) => ({ code: a.code, name: a.name, meta: a.group }))}
                      sel={popup.sel}
                      onPick={(code, name) => pickAccount(i, code, name)}
                    />
                  )}
                </span>
              </label>
              <div className="col-span-4 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>계정과목</span>
                <div
                  aria-label={`${i + 1}번째 줄 계정과목`}
                  className="h-10 px-2 rounded-[8px] flex items-center text-[14px] font-semibold truncate"
                  style={{ background: "var(--fill)", color: r.account ? "var(--text)" : "var(--sub)" }}
                >
                  {r.account || "코드를 입력"}
                </div>
              </div>
              <label className="col-span-3 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>거래처</span>
                <input
                  data-cell={`${i}:partner`}
                  aria-label={`${i + 1}번째 줄 거래처`}
                  className={CELL}
                  enterKeyHint="next"
                  value={r.partner}
                  onChange={(e) => setRow(i, { partner: e.target.value })}
                  onKeyDown={(e) => onCellKey(e, i, "partner")}
                />
              </label>
              <label className="col-span-3 md:col-span-1 flex flex-col gap-0.5">
                <span className={LABEL_M}>적요</span>
                <input
                  data-cell={`${i}:memo`}
                  aria-label={`${i + 1}번째 줄 적요`}
                  className={CELL}
                  enterKeyHint="next"
                  value={r.memo}
                  onChange={(e) => setRow(i, { memo: e.target.value })}
                  onKeyDown={(e) => onCellKey(e, i, "memo")}
                />
              </label>
              {(["dr", "cr"] as const).map((s) => (
                <label key={s} className="col-span-3 md:col-span-1 flex flex-col gap-0.5">
                  <span className={LABEL_M}>{s === "dr" ? "차변" : "대변"}</span>
                  {side === s && r.kind ? (
                    <input
                      data-cell={`${i}:amt`}
                      aria-label={`${i + 1}번째 줄 ${s === "dr" ? "차변" : "대변"} 금액`}
                      className={`${CELL} text-right tabular-nums`}
                      inputMode="numeric"
                      enterKeyHint="next"
                      value={comma(r.amount)}
                      onChange={(e) => setRow(i, { amount: digits(e.target.value) })}
                      onKeyDown={(e) => onCellKey(e, i, "amt")}
                    />
                  ) : (
                    <div className="h-10 px-2 rounded-[8px] flex items-center justify-end gap-1.5 text-[13px] tabular-nums text-sub" style={{ background: "var(--fill-2)" }}>
                      {cashOpp && r.amount ? (
                        <>
                          <span className="text-[11px]">현금</span>
                          {comma(r.amount)}
                        </>
                      ) : null}
                    </div>
                  )}
                </label>
              ))}
              <div className="col-span-6 md:col-span-1 flex justify-end md:justify-center items-end">
                <button
                  type="button"
                  onClick={() => deleteRow(i)}
                  aria-label={`${i + 1}번째 줄 삭제`}
                  title="줄 삭제 (F5)"
                  className="h-8 md:h-10 px-2.5 md:px-0 md:w-9 rounded-[8px] text-[13px] text-sub grid place-items-center hover:bg-[var(--fill)] hover:text-[var(--red)] transition-colors"
                >
                  <span className="md:hidden">줄 삭제</span>
                  <svg className="hidden md:block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setRows([...rows, emptyRow()]);
            focusAfter(`${rows.length}:kind`);
          }}
          className="self-start chip h-9 !text-[13px] !font-bold mt-1"
          style={{ color: "var(--text)" }}
        >
          + 줄 추가
        </button>
      </div>

      {/* 합계 — 차액이 0이 아니면 빨간색 */}
      <div className="grid grid-cols-3 gap-2 rounded-[12px] px-3 py-2.5 text-[13px]" style={{ background: "var(--fill-2)", border: "1px solid var(--border)" }}>
        <Total label="차변 합계" value={dr} />
        <Total label="대변 합계" value={cr} />
        <Total label="차액" value={Math.abs(diff)} bad={diff !== 0} />
      </div>
    </div>
  );
}

function HeadField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col justify-end gap-1 min-w-0">
      <span className="text-[12px] font-bold text-sub break-keep leading-snug">
        {label}
        {hint && <span className="font-normal"> · {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Total({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex flex-col items-end min-w-0">
      <span className="text-sub text-[12px]">{label}</span>
      <span className="font-bold text-[15px] tabular-nums" style={{ color: bad ? "var(--red)" : "var(--text)" }}>
        {value.toLocaleString("ko-KR")}
      </span>
    </div>
  );
}

// 코드 도움 팝업 — 입력칸 포커스를 뺏지 않는다(mousedown 기본동작 막음). ↑↓ 고르고 Enter, Esc 닫기
function CodeHelp({
  title,
  items,
  sel,
  empty = "맞는 항목이 없어요",
  onPick,
}: {
  title: string;
  items: { code: string; name: string; meta?: string }[];
  sel: number;
  empty?: string;
  onPick: (code: string, name: string) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  return (
    <div
      className="absolute left-0 top-full mt-1 z-30 w-[280px] max-w-[calc(100vw-56px)] rounded-[12px] overflow-hidden"
      style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", boxShadow: "var(--shadow-lift)" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <p className="px-3 py-2 text-[12px] font-bold text-sub border-b border-[var(--border)]">{title} · ↑↓ Enter</p>
      {items.length ? (
        <ul ref={listRef} role="listbox" aria-label={title} className="max-h-[240px] overflow-auto py-1">
          {items.map((it, k) => (
            <li
              key={`${it.code}-${it.name}`}
              data-i={k}
              role="option"
              aria-selected={k === sel}
              onClick={() => onPick(it.code, it.name)}
              className="flex items-center gap-2.5 px-3 h-9 text-[14px] cursor-pointer"
              style={k === sel ? { background: "var(--blue-weak)", color: "var(--blue)", fontWeight: 700 } : undefined}
            >
              <span className="tabular-nums w-8 shrink-0">{it.code}</span>
              <span className="flex-1 truncate">{it.name}</span>
              {it.meta && <span className="text-[11px] text-sub font-normal">{it.meta}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 py-3 text-[13px] text-sub">{empty}</p>
      )}
    </div>
  );
}
