// 실무 연습(KcLep 비슷한 전표 입력) — 계정과목·정답 파싱·채점.
// 화면(`/bank/practice`)과 검증 스크립트(`scripts/test-ledger.ts`)가 같이 쓴다. 외부 라이브러리 없음.
//
// 정답 원문은 문제은행 `bank_questions.answer_text` — 확정답안 PDF에서 뽑은 평문이라 형식이 제각각이다
// (`(차) 계정 금액원 (대) …`, 이어지는 줄, `[[표]]a|b|c[[/표]]`, `(또는 미지급비용)` 같은 복수 정답).
// 파싱이 확실하지 않은 문항은 null을 돌려 연습 목록에서 뺀다 — 틀린 정답으로 채점하는 것보다 낫다.

/** 급수 — 문제은행 subject 값 그대로 */
export type Grade = "전산회계2급" | "전산회계1급" | "전산세무2급" | "전산세무1급";
export const GRADES: Grade[] = ["전산회계2급", "전산회계1급", "전산세무2급", "전산세무1급"];

/** 연습 메뉴 — 문제은행 category 값 그대로 */
export type Menu = "일반전표" | "매입매출전표" | "결산";

/** 급수별로 시험에 나오는 메뉴. 전산회계2급은 개인 도소매업이라 부가세(매입매출전표)가 없다 */
export const MENUS: Record<Grade, Menu[]> = {
  전산회계2급: ["일반전표", "결산"],
  전산회계1급: ["일반전표", "매입매출전표", "결산"],
  전산세무2급: ["일반전표", "매입매출전표", "결산"],
  전산세무1급: ["일반전표", "매입매출전표", "결산"],
};

export type AccountGroup = "자산" | "부채" | "자본" | "수익" | "비용";

export type Account = {
  code: string; // KcLep 기본 계정코드 3자리 (예: "101")
  name: string; // 계정과목명 (예: "현금", "복리후생비")
  group: AccountGroup;
  /** 채권·채무 계정 — KcLep 채점에서 거래처 입력이 필요한 계정 */
  needsPartner?: boolean;
};

// ── 계정과목표 ──────────────────────────────────────────────
// KcLep 기본 코드. 500번대(제조원가)는 이름 뒤에 (제), 800번대(판관비)는 (판)을 자동으로 붙인다 —
// 정답 원문이 "복리후생비(판)"처럼 적기 때문. 같은 이름이 여러 코드에 있는 계정(대손충당금 109/111/…,
// 감가상각누계액 203/207/…)은 이름으로 채점하므로 어느 코드를 골라도 같은 계정으로 본다.
const RAW_ACCOUNTS = `
101 현금|102 당좌예금|103 보통예금|104 기타제예금|105 정기예금|106 정기적금|107 단기매매증권
108 외상매출금|109 대손충당금|110 받을어음|111 대손충당금|112 공사미수금|114 단기대여금|115 대손충당금
116 미수수익|117 외화예금|120 미수금|121 대손충당금|122 소모품|131 선급금|133 선급비용|134 가지급금|135 부가세대급금
136 선납세금|137 주임종단기채권|138 전도금|141 현금과부족|146 상품|147 매입환출및에누리|148 매입할인
150 제품|153 원재료|154 매입환출및에누리|155 매입할인|156 미착품|162 부재료|169 재공품|173 재고자산평가충당금
176 장기성예금|177 특정현금과예금|178 매도가능증권|179 장기대여금|181 만기보유증권|183 투자부동산
186 퇴직연금운용자산|187 퇴직보험예치금|195 장기미수금
201 토지|202 건물|203 감가상각누계액|204 구축물|205 감가상각누계액|206 기계장치|207 감가상각누계액
208 차량운반구|209 감가상각누계액|210 공구와기구|211 감가상각누계액|212 비품|213 감가상각누계액
214 건설중인자산|216 국고보조금|217 국고보조금|218 영업권|219 특허권|220 상표권|221 실용신안권
222 디자인권|226 개발비|227 소프트웨어|228 산업재산권|229 라이선스|232 임차보증금|233 전세권
234 기타보증금|235 장기선급비용|236 리스보증금|237 이연법인세자산|240 부도어음과수표|241 대손충당금
251 외상매입금|252 지급어음|253 미지급금|254 예수금|255 부가세예수금|256 당좌차월|257 가수금
259 선수금|260 단기차입금|261 미지급세금|262 미지급비용|263 선수수익|264 유동성장기부채|265 미지급배당금|266 미지급이자|267 리스부채
271 유동성장기차입금|291 사채|292 사채할인발행차금|293 장기차입금|294 임대보증금|295 퇴직급여충당부채
296 퇴직연금충당부채|303 장기미지급금|305 외화장기차입금|307 장기선수금|313 사채할증발행차금
310 이연법인세부채|320 장기미지급비용|329 퇴직연금미지급금
331 자본금|338 인출금|341 주식발행초과금|342 감자차익|343 자기주식처분이익|351 이익준비금
352 기업합리화적립금|354 재무구조개선적립금|356 사업확장적립금|357 감채적립금|375 이월이익잉여금
377 미처분이익잉여금|378 미처리결손금|381 주식할인발행차금|383 자기주식|387 미교부주식배당금
389 자기주식처분손실|390 감자차손|394 매도가능증권평가이익|395 매도가능증권평가손실|396 중간배당금|398 재평가차익
401 상품매출|402 매출환입및에누리|403 매출할인|404 제품매출|405 매출환입및에누리|406 매출할인
407 공사수입금|410 용역매출|411 임대료수입|451 상품매출원가|455 제품매출원가
501 원재료비|503 급여|504 임금|505 상여금|506 제수당|507 잡급|508 퇴직급여|511 복리후생비
512 여비교통비|513 기업업무추진비|514 통신비|515 가스수도료|516 전력비|517 세금과공과|518 감가상각비
519 임차료|520 수선비|521 보험료|522 차량유지비|523 경상연구개발비|524 운반비|525 교육훈련비
526 도서인쇄비|527 회의비|528 포장비|529 사무용품비|530 소모품비|531 수수료비용|532 보관료
533 외주가공비|534 시험비|535 기밀비|536 잡비|537 폐기물처리비|538 무형자산상각비|539 건물관리비
801 급여|802 임원급여|803 상여금|804 제수당|805 잡급|806 퇴직급여|807 퇴직연금충당금전입액
811 복리후생비|812 여비교통비|813 기업업무추진비|814 통신비|815 수도광열비|816 전력비|817 세금과공과
818 감가상각비|819 임차료|820 수선비|821 보험료|822 차량유지비|823 경상연구개발비|824 운반비
825 교육훈련비|826 도서인쇄비|827 회의비|828 포장비|829 사무용품비|830 소모품비|831 수수료비용
832 보관료|833 광고선전비|834 판매촉진비|835 대손상각비|836 기밀비|837 건물관리비|838 수출제비용
839 판매수수료|840 무형자산상각비|841 환가료|842 견본비|843 해외접대비|844 해외시장개척비
847 하자보수비|848 잡비|850 연구비|851 주식보상비용
901 이자수익|902 만기보유증권이자|903 배당금수익|904 임대료|905 단기매매증권평가이익
906 단기매매증권처분이익|907 외환차익|908 대손충당금환입|909 수수료수익|910 외화환산이익
911 사채상환이익|912 전기오류수정이익|913 판매장려금|914 유형자산처분이익|915 투자자산처분이익
916 매도가능증권처분이익|917 자산수증이익|918 채무면제이익|919 보험차익|920 만기보유증권처분이익|921 퇴직연금운용수익
924 재고자산감모손실환입|925 재고자산평가손실환입|926 투자자산손상차손환입|927 국고보조금수익|930 잡이익
951 이자비용|952 외환차손|953 기부금|954 기타의대손상각비|955 외화환산손실|956 매출채권처분손실
957 단기매매증권평가손실|958 단기매매증권처분손실|959 재고자산감모손실|960 재고자산평가손실|961 재해손실
962 전기오류수정손실|963 투자자산처분손실|964 매도가능증권처분손상차손|965 매도가능증권손상차손
966 만기보유증권손상차손|967 사채상환손실|970 유형자산처분손실|971 투자자산손상차손|972 유형자산손상차손
973 만기보유증권처분손실|974 매도가능증권처분손실|976 무형자산손상차손|980 잡손실|984 수수료비용
998 법인세등
`;

// 거래처가 필요한 채권·채무 계정 (KcLep 채점 기준)
const PARTNER_ACCOUNTS = new Set(
  (
    "외상매출금 받을어음 미수금 선급금 단기대여금 공사미수금 장기대여금 장기미수금 부도어음과수표 " +
    "임차보증금 기타보증금 가지급금 외상매입금 지급어음 미지급금 선수금 단기차입금 장기차입금 " +
    "유동성장기부채 유동성장기차입금 외화장기차입금 임대보증금 장기미지급금 장기선수금 미지급비용 가수금"
  ).split(" ")
);

function groupOf(code: number): AccountGroup {
  if (code < 251) return "자산";
  if (code < 331) return "부채";
  if (code < 401) return "자본";
  if (code < 451 || (code >= 901 && code < 951)) return "수익";
  return "비용";
}

/** 계정과목표 (KcLep 기본 코드 기준) */
export const ACCOUNTS: Account[] = RAW_ACCOUNTS.trim()
  .split(/[|\n]/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [code, base] = s.split(" ");
    const n = Number(code);
    const name = n >= 500 && n < 600 ? `${base}(제)` : n >= 800 && n < 900 ? `${base}(판)` : base;
    return { code, name, group: groupOf(n), ...(PARTNER_ACCOUNTS.has(base) ? { needsPartner: true } : {}) };
  });

const BY_CODE = new Map(ACCOUNTS.map((a) => [a.code, a]));
const BY_NAME = new Map<string, Account>();
for (const a of ACCOUNTS) if (!BY_NAME.has(a.name)) BY_NAME.set(a.name, a);

const needsPartner = (name: string) => Boolean(BY_NAME.get(name)?.needsPartner);

/** "복리후생비(판)" → "복리후생비" */
const baseOf = (name: string) => name.replace(/\((판|제)\)$/, "");
const BY_BASE = new Map<string, string[]>();
for (const name of BY_NAME.keys()) {
  const b = baseOf(name);
  BY_BASE.set(b, [...(BY_BASE.get(b) ?? []), name]);
}

// 같은 계정의 다른 이름 → 표의 이름. 2024년 접대비 → 기업업무추진비 개칭 등
const SYNONYMS: Record<string, string> = {
  접대비: "기업업무추진비",
  지급수수료: "수수료비용",
  세금과공과금: "세금과공과",
  부가가치세예수금: "부가세예수금",
  부가가치세대급금: "부가세대급금",
  보험금수익: "보험차익",
  지급임차료: "임차료",
  법인세비용: "법인세등",
  법인세등비용: "법인세등",
  가스수도비: "가스수도료",
  임금급여: "임금",
  무형고정자산상각: "무형자산상각비",
};

/** 계정명 정규화 (공백 제거·(판관비)→(판)·동의어). 채점은 이 값끼리 비교한다 */
export function normalizeAccount(name: string): string {
  const s = name.replace(/\s+/g, "");
  const m = s.match(/^(.*?)(?:\((판|판관비|판매비와관리비|제|제조|제조원가)\))?$/);
  const base = m?.[1] ?? s;
  const suf = m?.[2] ? (m[2].startsWith("판") ? "(판)" : "(제)") : "";
  return (SYNONYMS[base] ?? base) + suf;
}

/** 계정 정보 (정규화 후 이름으로). 표에 없으면 undefined */
export function accountOf(name: string): Account | undefined {
  return BY_NAME.get(normalizeAccount(name));
}

/** 코드 앞자리 또는 이름 일부로 찾기 (코드 도움 F2 팝업용) */
export function findAccounts(q: string): Account[] {
  const s = q.replace(/\s+/g, "");
  if (!s) return [];
  if (/^\d+$/.test(s)) return ACCOUNTS.filter((a) => a.code.startsWith(s)).slice(0, 30);
  const keys = [s];
  const syn = normalizeAccount(s);
  if (syn !== s) keys.push(baseOf(syn));
  if (s.includes("접대")) keys.push("기업업무추진비");
  const score = (a: Account) => {
    const b = baseOf(a.name);
    let best = 9;
    for (const k of keys) {
      if (b === k || a.name === k) best = Math.min(best, 0);
      else if (b.startsWith(k)) best = Math.min(best, 1);
      else if (a.name.includes(k)) best = Math.min(best, 2);
    }
    return best;
  };
  return ACCOUNTS.map((a) => ({ a, r: score(a) }))
    .filter((x) => x.r < 9)
    // 같은 순위면 판관비(8xx)를 제조원가(5xx)보다 먼저 — 대부분 판관비로 쓰니까
    .sort((x, y) => x.r - y.r || Number(x.a.code[0] === "5") - Number(y.a.code[0] === "5") || x.a.code.localeCompare(y.a.code))
    .slice(0, 30)
    .map((x) => x.a);
}

/** 매입매출전표 유형 (11.과세, 12.영세, 51.과세매입, 54.불공, 57.카과 …) */
export type SalesType = { code: string; name: string; kind: "매출" | "매입" };
export const SALES_TYPES: SalesType[] = [
  ...["11 과세", "12 영세", "13 면세", "14 건별", "16 수출", "17 카과", "18 카면", "19 카영", "22 현과", "23 현면", "24 현영"].map(
    (s) => ({ code: s.slice(0, 2), name: s.slice(3), kind: "매출" as const })
  ),
  ...["51 과세", "52 영세", "53 면세", "54 불공", "55 수입", "57 카과", "58 카면", "59 카영", "61 현과", "62 현면"].map(
    (s) => ({ code: s.slice(0, 2), name: s.slice(3), kind: "매입" as const })
  ),
];
const TYPE_CODES = new Set(SALES_TYPES.map((t) => t.code));
/** 부가세가 없는 유형 — 영세율(12·16·19·24·52·59) + 면세(13·18·23·53·58·62). 정답에 부가세 칸이 없으면 0으로 본다 */
export const ZERO_VAT = new Set(["12", "16", "19", "24", "52", "59", "13", "18", "23", "53", "58", "62"]);
/** 유형별 부가세율 (0 또는 0.1). 54.불공·55.수입도 10% */
export const vatRate = (code: string) => (ZERO_VAT.has(code) ? 0 : 0.1);

/** "51" → "51.과세" (화면·채점 메시지용) */
export const salesTypeLabel = (code: string) => {
  const t = SALES_TYPES.find((x) => x.code === code);
  return t ? `${t.code}.${t.name}` : code;
};

/** 분개 한 줄. account는 계정과목명 (코드 아님) */
export type Line = { side: "차" | "대"; account: string; partner?: string; amount: number };

/** 매입매출전표 위쪽 칸 */
export type SalesHeader = {
  type: string; // 유형 코드 (예: "51")
  supply: number; // 공급가액
  vat: number; // 부가세
  partner?: string; // 거래처
  electronic?: boolean; // 전자 여부
};

/** 파싱된 정답. 정답 줄의 accounts는 인정되는 계정명 목록 (복수 정답 "또는") */
export type AnswerLine = { side: "차" | "대"; accounts: string[]; partner?: string; amount: number };
export type Answer = {
  date?: string; // "MM-DD"
  header?: SalesHeader & { types?: string[] }; // types: 인정되는 유형 코드 목록
  lines: AnswerLine[];
};

// ── 정답 파싱 ──────────────────────────────────────────────
type Side = "차" | "대";
type Item = { side?: Side; hint?: Side; accounts: string[]; partner?: string; amount: number };
type Alt = { side?: Side; accounts: string[]; amount?: number; prev?: Item }; // prev: 바로 앞에 적힌 항목
type Ctx = { unknown: string[]; partners: string[] };
class Fail extends Error {}
const fail = (why: string): never => {
  throw new Fail(why);
};

const AMT_OK = /^(\d{1,3}(,\d{3})+|\d+)$/;

function cleanText(t: string): string {
  return t
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[：]/g, ":")
    .replace(/[－−–]/g, "-")
    .replace(/[\u00a0\t]/g, " ")
    .replace(/또는\s*[|\s]*\(\s*결\s*[차대]\s*\)/g, "또는 (결산)") // "또는 (결차)…" = 같은 분개를 결산 화면으로
    .replace(/\(\s*결?\s*([차대])\s*\)/g, "($1)") // (결차)/(결대)는 결산 분개의 차/대
    .replace(/(?<![(가-힣])([차대])\)/g, "($1)") // "차) 현금 …" 여는 괄호 빠진 표기
    .replace(/\(주\d+\)|주\d+\)/g, "") // 각주 표시 (주1), 주1)
    .replace(/원 *\*\d+(?![\d,])/g, "원")
    .replace(/(\d) *원? *\*\d*(?=[ |∥]|$)/gm, "$1원") // 각주 표시 *2 (줄 머리 "* 설명"은 건드리지 않게 같은 줄만)
    .replace(/(?<![\d,])(\d{3})\.(?=[가-힣])/g, "($1)") // "109.대손충당금" 코드 앞붙임
    .replace(/\r/g, "");
}

// 괄호 안을 가린 사본 (인덱스 유지) — 괄호 속 숫자(코드·적요)를 금액으로 오인하지 않게
function maskParens(s: string): string {
  let depth = 0;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") depth++;
    out += depth > 0 ? "_" : ch;
    if (ch === ")" && depth > 0) depth--;
  }
  return out;
}

// 최상위 괄호 그룹 분리: "미지급금(국민카드)(판)" → base "미지급금", groups ["국민카드","판"]
function splitParens(s: string): { base: string; groups: string[] } {
  let depth = 0;
  let base = "";
  let cur = "";
  const groups: string[] = [];
  for (const ch of s) {
    if (ch === "(") {
      if (depth > 0) cur += ch;
      depth++;
    } else if (ch === ")" && depth > 0) {
      depth--;
      if (depth === 0) {
        groups.push(cur.trim());
        cur = "";
      }
      else cur += ch;
    } else if (depth > 0) cur += ch;
    else base += ch;
  }
  if (depth > 0) groups.push(cur.trim());
  return { base, groups };
}

// 최상위(괄호 밖) "또는"으로 나누기
function splitOr(s: string): string[] {
  const m = maskParens(s);
  const out: string[] = [];
  let last = 0;
  for (const x of m.matchAll(/또는/g)) {
    out.push(s.slice(last, x.index));
    last = x.index! + 2;
  }
  out.push(s.slice(last));
  return out.map((x) => x.trim().replace(/^,|,$/g, "").trim()).filter(Boolean);
}

/** 계정 표기(대체 표기 포함) → 인정 계정명 목록 + 거래처. 표에 없는 이름이면 Fail */
function resolveName(seg: string, ctx: Ctx): { accounts: string[]; partner?: string } {
  const accounts: string[] = [];
  let partner: string | undefined;
  const parts = splitOr(seg.replace(/^\s*또는\s*,?/, ""));
  if (!parts.length) fail("빈 계정명");
  for (let k = 0; k < parts.length; k++) {
    const { base, groups } = splitParens(parts[k]);
    let suf = "";
    let codes: string[] = [];
    for (const g of groups) {
      if (/^또는/.test(g)) parts.push(g.replace(/^또는\s*/, ""));
      else if (/^(판|판관비|판매비와관리비|판매관리비|판관)$/.test(g)) suf = "판";
      else if (/^(제|제조|제조원가|제조경비)$/.test(g)) suf = "제";
      else if (/^\d{3}(\s*또는\s*\d{3})*$/.test(g)) codes = g.match(/\d{3}/g)!;
      else if (/^\d{3}\.?[가-힣]+$/.test(g)) codes = [g.slice(0, 3)]; // (109.외상매출금)
      else if (/^적요/.test(g) || /^\d+$/.test(g)) continue;
      else if (/^(거래처|거래처명|공급처)\s*:/.test(g)) partner ??= g.replace(/^[^:]*:\s*/, "").trim();
      else if (ALT_PAIRS[normalizeAccount(base.replace(/\s/g, ""))]?.includes(normalizeAccount(g))) parts.push(g); // 미지급금(미지급비용)
      else if (g) partner ??= g;
    }
    const b0 = base.replace(/[^가-힣A-Za-z0-9]/g, "");
    if (!b0) {
      // "(984 또는 831)" 같은 코드만 있는 꼬리 — 앞 계정에 붙인다
      if (codes.length && accounts.length) {
        for (const c of codes) {
          const a = BY_CODE.get(c);
          if (a && baseOf(a.name) === baseOf(accounts[0])) accounts.push(a.name);
        }
        continue;
      }
      fail("빈 계정명");
    }
    let b = normalizeAccount(b0);
    // 칸이 밀려 앞에 붙은 "원" ("원받을어음")
    if (!BY_BASE.has(b) && b.startsWith("원") && BY_BASE.has(normalizeAccount(b.slice(1)))) b = normalizeAccount(b.slice(1));
    let found: string[] = [];
    if (codes.length) {
      for (const c of codes) {
        const a = BY_CODE.get(c);
        if (a && baseOf(a.name) === b) found.push(a.name);
      }
    }
    if (!found.length && suf) found = BY_NAME.has(`${b}(${suf})`) ? [`${b}(${suf})`] : [];
    // (판)/(제)를 안 적은 정답은 둘 다 인정 — 원문이 구분하지 않았으니
    if (!found.length && !suf) found = BY_BASE.get(b) ?? [];
    if (!found.length) {
      if (/^[가-힣]{2,12}$/.test(b) && base.trim().length < 20) ctx.unknown.push(suf ? `${b}(${suf})` : b);
      fail(`모르는 계정: ${b}`);
    }
    for (const f of found) if (!accounts.includes(f)) accounts.push(f);
  }
  if (partner && /^(없음|-)$/.test(partner)) partner = undefined;
  return { accounts, ...(partner ? { partner } : {}) };
}

type Tok =
  | { kind: "item"; name: string; amount: number }
  | { kind: "alt"; name: string; amount?: number }
  | { kind: "partner"; name: string }; // 금액 뒤에 붙은 "(거래처)"

// 금액 뒤 괄호가 거래처인지 (코드·적요·대체 계정 제외)
const isPartnerParen = (g: string) => !/^(또는|적요)|타계정|^\d{3}$/.test(g);

/** "계정 1,000원 계정2 2,000 원 (또는 X)" → 토큰. 해석 못 하는 꼬리가 남으면 null */
function tokenize(raw: string): Tok[] | null {
  // 표 칸이 밀려 남은 단독 "원" 제거 ("원 원", "원원")
  const text = raw
    .replace(/\[([^\]]*)\]/g, "($1)")
    .replace(/(?<![가-힣\d,])원(?![가-힣])/g, " ")
    .replace(/(\d)\s*원원/g, "$1원");
  const masked = maskParens(text);
  const out: Tok[] = [];
  let last = 0;
  for (const m of masked.matchAll(/(-?)(\d[\d,]*)(\s*원(?![가-힣]))?/g)) {
    if (!AMT_OK.test(m[2])) return null;
    let name = text.slice(last, m.index).trim();
    const amount = Number(m[1] + m[2].replace(/,/g, ""));
    last = m.index! + m[0].length;
    // 앞 항목 꼬리의 "(또는 X)"
    const lead = name.match(/^\(또는([^()]*(?:\([^()]*\))?[^()]*)\)\s*/);
    if (lead) {
      out.push({ kind: "alt", name: lead[1].trim() });
      name = name.slice(lead[0].length).trim();
    }
    // 앞 항목 금액 뒤에 붙은 "(거래처)"
    const pp = out.length ? leadParen(name) : null;
    if (pp && isPartnerParen(pp.g)) {
      out.push({ kind: "partner", name: pp.g });
      name = name.slice(pp.len).trim();
    }
    if (!name) return null;
    out.push(/^또는/.test(name) ? { kind: "alt", name, amount } : { kind: "item", name, amount });
  }
  const rest = text.slice(last).trim();
  if (rest) {
    const r = rest.replace(/^\((또는[\s\S]*)\)$/, "$1");
    const pp = leadParen(rest);
    if (/^또는/.test(r)) for (const p of splitOr(r)) out.push({ kind: "alt", name: p });
    else if (pp && pp.len === rest.length && isPartnerParen(pp.g)) out.push({ kind: "partner", name: pp.g });
    else if (!/^\([^)]*(적요|타계정)[^)]*\)$/.test(rest)) return null;
  }
  return out;
}

// 맨 앞 괄호 그룹 (중첩 허용): "((주)봄꽃상사) 외상…" → g "(주)봄꽃상사"
function leadParen(s: string): { g: string; len: number } | null {
  if (s[0] !== "(") return null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return { g: s.slice(1, i).trim(), len: i + 1 };
  }
  return null;
}

function addTokens(toks: Tok[], side: Side | undefined, hint: Side | undefined, items: Item[], alts: Alt[], ctx: Ctx) {
  const n0 = items.length;
  for (const t of toks) {
    if (t.kind === "partner") {
      // 바로 앞 항목이 거래처 계정이면 그 항목의 거래처, 아니면 나중에 유일한 거래처 계정에 붙인다
      const prev = items.length > n0 ? items[items.length - 1] : undefined;
      if (prev && !prev.partner && prev.accounts.some(needsPartner)) prev.partner = t.name;
      else ctx.partners.push(t.name);
      continue;
    }
    const r = resolveName(t.name, ctx);
    if (t.kind === "item") items.push({ side, hint, accounts: r.accounts, partner: r.partner, amount: t.amount });
    else
      alts.push({
        side: side ?? hint,
        accounts: r.accounts,
        amount: t.amount,
        prev: items.length > n0 ? items[items.length - 1] : undefined,
      });
  }
}

const sumOf = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

// 열 정보가 없는 이어지는 줄의 차/대 복원 — 대차평형을 만족하는 배치가 하나뿐일 때만 채택.
// hint(표의 열, 한 줄에 두 항목이면 왼쪽=차·오른쪽=대)를 지키는 해를 먼저 찾는다.
function solveSides(fixed: Item[], cont: Item[]): void {
  if (!cont.length) return;
  if (cont.length > 14) fail("이어지는 항목이 너무 많음");
  const d0 = sumOf(fixed.filter((x) => x.side === "차"));
  const c0 = sumOf(fixed.filter((x) => x.side === "대"));
  const hinted: number[] = [];
  const all: number[] = [];
  for (let mask = 0; mask < 1 << cont.length; mask++) {
    let d = d0;
    let c = c0;
    let ok = true;
    for (let i = 0; i < cont.length; i++) {
      const s: Side = (mask >> i) & 1 ? "대" : "차";
      if (s === "대") c += cont[i].amount;
      else d += cont[i].amount;
      if (cont[i].hint && cont[i].hint !== s) ok = false;
    }
    if (d !== c) continue;
    all.push(mask);
    if (ok) hinted.push(mask);
  }
  const pick = hinted.length === 1 ? hinted[0] : hinted.length === 0 && all.length === 1 ? all[0] : null;
  if (pick === null) fail(all.length ? "차/대 복원 불확실" : "대차 불일치");
  cont.forEach((x, i) => (x.side = (pick! >> i) & 1 ? "대" : "차"));
}

// 대체 계정("또는 미지급비용")을 붙일 항목 — 같은 그룹(자산/부채/…)의 항목이 하나뿐일 때만
// 정답 원문에 자주 나오는 대체 계정 짝 (예: 카드 결제 미지급금 ↔ 미지급비용)
const ALT_PAIRS: Record<string, string[]> = {
  미지급비용: ["미지급금"],
  미지급금: ["미지급비용"],
  단기차입금: ["당좌차월"],
  당좌차월: ["단기차입금"],
  자본금: ["인출금"],
  인출금: ["자본금"],
  임금: ["급여"],
  급여: ["임금"],
  원재료: ["매입환출및에누리", "매입할인"],
  상품: ["매입환출및에누리", "매입할인"],
};

function attachAlts(items: Item[], alts: Alt[]): void {
  for (const a of alts) {
    const g = BY_NAME.get(a.accounts[0])?.group;
    let cands = items.filter(
      (it) => BY_NAME.get(it.accounts[0])?.group === g && !a.accounts.every((x) => it.accounts.includes(x))
    );
    if (a.side) cands = cands.filter((it) => it.side === a.side);
    if (a.amount !== undefined) cands = cands.filter((it) => it.amount === a.amount);
    // 여럿이면: 바로 앞 항목 → 흔한 대체 짝 → 같은 (판)/(제) 순으로 좁힌다
    const narrow = (f: (it: Item) => boolean) => {
      if (cands.length > 1 && cands.some(f)) cands = cands.filter(f);
    };
    narrow((it) => it === a.prev);
    narrow((it) => it.accounts.some((x) => ALT_PAIRS[baseOf(a.accounts[0])]?.includes(baseOf(x))));
    narrow((it) => it.accounts.some((x) => x.slice(-3) === a.accounts[0].slice(-3) && /\((판|제)\)$/.test(x)));
    if (cands.length !== 1) {
      // 이미 그 계정이 정답에 있으면(중복 표기) 무시
      if (items.some((it) => a.accounts.every((x) => it.accounts.includes(x)))) continue;
      fail("대체 계정 대상 불명");
    }
    for (const x of a.accounts) if (!cands[0].accounts.includes(x)) cands[0].accounts.push(x);
  }
}

type Unit = { cells: string[]; tid: number }; // tid 0 = 평문 줄, 그 외 = 표 번호

function unitsOf(text: string): Unit[] {
  const out: Unit[] = [];
  const plain = (s: string) => {
    for (const l of s.split("\n")) if (l.trim()) out.push({ cells: [l], tid: 0 });
  };
  let last = 0;
  let tid = 0;
  for (const m of text.matchAll(/\[\[표\]\]([\s\S]*?)\[\[\/표\]\]/g)) {
    plain(text.slice(last, m.index));
    tid++;
    for (const row of m[1].split(/∥|\n/)) out.push({ cells: row.split("|"), tid });
    last = m.index! + m[0].length;
  }
  plain(text.slice(last));
  return out;
}

// "또는 출금전표 …", "또는 (결차)…" — 같은 분개를 다른 화면으로 입력하는 방법이라 버린다
const SAME_ENTRY_ALT = /또는\s*,?\s*[|\s]*\(?\s*(출금|입금|결산\))[\s\S]*$/;
const ALT_MARK = "〔대체입력〕"; // 이 줄부터는 같은 분개의 다른 입력 방법 — 이어지는 줄 수집을 멈춘다
const joined = (u: Unit) => u.cells.join(" ").replace(/\s+/g, " ").trim();

function dateOf(text: string): string | undefined {
  const a = text.match(/(?:19|20)\d{2}\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/);
  const b = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const m = a ?? b;
  return m ? `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : undefined;
}

const HKEY =
  /(유형(?![가-힣])|공급가액|(?<![가-힣])부가가?치?세(?![가-힣])|(?<![가-힣])세액(?![가-힣])|거래처명|거래처|공급처명|공급처|(?<![가-힣])전자(?![가-힣])|분개|영세율\s*구분|불공제\s*사유|신용카드사|품목|수출신고번호)\s*:?/g;

function parseHeader(all: string): (SalesHeader & { types?: string[] }) | null {
  // 세금계산서 표 등 앞에 붙은 글은 버리고 마지막 "유형"부터 본다
  const at = [...all.matchAll(/유형(?![가-힣])/g)].pop()?.index;
  if (at === undefined) return null;
  const text = all.slice(at);
  const keys = [...text.matchAll(HKEY)];
  const f: Record<string, string> = {};
  keys.forEach((k, i) => {
    const name = k[1].replace(/\s/g, "");
    const key = /^(거래처|거래처명|공급처|공급처명)$/.test(name) ? "거래처" : /^(세액|부가가치세)$/.test(name) ? "부가세" : name;
    if (f[key] !== undefined) return;
    f[key] = text
      .slice(k.index! + k[0].length, keys[i + 1]?.index ?? text.length)
      .replace(/^[\s,|]+|[\s,|]+$/g, "");
  });
  if (f.유형 === undefined) return null;
  const types = [...f.유형.matchAll(/(?<!\d)(\d{2})(?!\d)/g)].map((m) => m[1]).filter((c) => TYPE_CODES.has(c));
  if (!types.length) return null;
  const amt = (v?: string) => {
    const m = v?.match(/-?\d[\d,]*/);
    return m && AMT_OK.test(m[0].replace("-", "")) ? Number(m[0].replace(/,/g, "")) : undefined;
  };
  const supply = amt(f.공급가액);
  let vat = amt(f.부가세);
  if (vat === undefined && ZERO_VAT.has(types[0])) vat = 0;
  if (supply === undefined || vat === undefined) return null;
  const p = f.거래처?.replace(/^\((.*)\)$/, "$1").trim(); // "원"을 떼면 안 된다 — ㈜항원
  const e = f.전자?.trim();
  return {
    type: types[0],
    types,
    supply,
    vat,
    ...(p && !/^(없음|-)$/.test(p) ? { partner: p } : {}),
    ...(e?.startsWith("여") ? { electronic: true } : e?.startsWith("부") ? { electronic: false } : {}),
  };
}

/** 파싱 상세 (검증 스크립트용). reason은 실패 사유, unknown은 표에 없는 계정명 */
export function explainParse(
  answerText: string,
  category: Menu
): { answer: Answer | null; reason?: string; unknown: string[] } {
  const ctx: Ctx = { unknown: [], partners: [] };
  try {
    return { answer: parseInner(answerText, category, ctx), unknown: ctx.unknown };
  } catch (e) {
    if (e instanceof Fail) return { answer: null, reason: e.message, unknown: ctx.unknown };
    throw e;
  }
}

function parseInner(answerText: string, category: Menu, ctx: Ctx): Answer {
  const text = cleanText(answerText || "");
  const units = unitsOf(text)
    .map((u) => {
      const j = joined(u);
      const m = j.match(SAME_ENTRY_ALT);
      if (m && m.index === 0) return { ...u, cells: [ALT_MARK] };
      return { ...u, cells: u.cells.map((c) => c.replace(SAME_ENTRY_ALT, "")) };
    })
    .filter((u) => joined(u));

  const start = units.findIndex((u) => joined(u).includes("(차)"));
  if (start < 0) fail("분개 없음");
  if (/^또는/.test(joined(units[start]))) fail("대체 분개만 있음");

  // 결산자료입력(자동 결산) 답 — 분개가 "또는"으로 같이 적힌 경우만 받는다
  const before = units.slice(0, start).map(joined).join("\n");
  if (/결산자료/.test(before) && !/또는|선택|방법|무관|해도/.test(before)) fail("결산자료입력");

  const fixed: Item[] = [];
  const cont: Item[] = [];
  const alts: Alt[] = [];
  const first = units[start];
  let i = start + 1;

  if (first.tid) {
    // 표: 열 위치가 살아 있다 — (대) 칸 왼쪽이 차변, 오른쪽이 대변
    const di = first.cells.findIndex((c) => c.includes("(대)"));
    if (di < 0) fail("표에 (대) 없음");
    const sideTexts = (u: Unit, firstRow: boolean): [string, string] => {
      let d = u.cells.slice(0, di).join(" ");
      if (firstRow) d = d.slice(d.indexOf("(차)") + 3);
      const c = u.cells.slice(di).join(" ").replace("(대)", " ");
      return [d, c];
    };
    if (/\(차\)\s*\(차\)/.test(joined(first))) fail("분개 여러 개");
    const [d, c] = sideTexts(first, true);
    const td = tokenize(d);
    const tc = tokenize(c);
    if (!td || !tc) fail("표 칸 해석 실패");
    addTokens(td!, "차", undefined, fixed, alts, ctx);
    addTokens(tc!, "대", undefined, fixed, alts, ctx);
    // 다음 줄들: 칸 위치를 hint로. 해석 안 되는 줄(계산 메모 등)에서 분개 끝
    for (; i < units.length && units[i].tid === first.tid; i++) {
      const j = joined(units[i]);
      if (/\(차\)/.test(j)) break;
      const [d2, c2] = sideTexts(units[i], false);
      const t2d = tokenize(d2);
      const t2c = tokenize(c2);
      if (!t2d || !t2c) break;
      const its: Item[] = [];
      const als: Alt[] = [];
      try {
        addTokens(t2d, undefined, "차", its, als, ctx);
        addTokens(t2c, undefined, "대", its, als, ctx);
      } catch (e) {
        if (e instanceof Fail) break;
        throw e;
      }
      cont.push(...its);
      alts.push(...als);
    }
    for (; i < units.length && units[i].tid === first.tid; i++) {
      const j = joined(units[i]);
      if (j.includes("(차)")) fail(/^또는/.test(j) ? "대체 분개" : "분개 여러 개");
    }
  } else {
    // 평문: 첫 줄은 (차)…(대)…, 이어지는 줄은 열 정보가 없다
    let line = first.cells[0];
    if (!line.includes("(대)") && units[i] && !units[i].tid && /^\s*\(대\)/.test(units[i].cells[0])) {
      line += " " + units[i].cells[0];
      i++;
    }
    const ci = line.indexOf("(차)");
    const di = line.indexOf("(대)");
    if (di < ci) fail("(대) 없음");
    const td = tokenize(line.slice(ci + 3, di));
    const tc = tokenize(line.slice(di + 3));
    if (!td || !tc) fail("첫 줄 해석 실패");
    addTokens(td!, "차", undefined, fixed, alts, ctx);
    addTokens(tc!, "대", undefined, fixed, alts, ctx);
  }

  // 이어지는 평문 줄 — 계정·금액으로만 된 줄이면 분개의 일부, 아니면 분개 끝
  for (; i < units.length; i++) {
    const u = units[i];
    if (u.tid) break;
    const l = u.cells[0].trim();
    if (l.includes("(차)")) break;
    const toks = tokenize(l);
    if (!toks || !toks.length) break;
    const its: Item[] = [];
    const als: Alt[] = [];
    try {
      addTokens(toks, undefined, undefined, its, als, ctx);
    } catch (e) {
      if (e instanceof Fail) break;
      throw e;
    }
    if (its.length === 2 && !als.length) {
      its[0].hint = "차";
      its[1].hint = "대";
    }
    cont.push(...its);
    alts.push(...als);
  }
  // 분개 뒤에 또 분개가 있으면 (다른 날짜·대체 분개) 확실하지 않다
  for (; i < units.length; i++) {
    const j = joined(units[i]);
    if (j.includes("(차)")) fail(/^또는/.test(j) ? "대체 분개" : "분개 여러 개");
    // 결산자료입력이 "또는"/"(방법2)"로 적힌 다른 방법이면 괜찮고, 추가로 해야 하는 단계면 확실하지 않다
    if (/결산자료/.test(j) && !/또는|방법/.test(j + (units[i - 1] ? joined(units[i - 1]) : ""))) fail("결산자료입력 병행");
  }

  if (!fixed.some((x) => x.side === "차") || !fixed.some((x) => x.side === "대")) fail("차/대 한쪽 비어 있음");
  solveSides(fixed, cont);
  const items = [...fixed, ...cont];
  if (sumOf(items.filter((x) => x.side === "차")) !== sumOf(items.filter((x) => x.side === "대"))) fail("대차 불일치");
  if (sumOf(items.filter((x) => x.side === "차")) === 0) fail("금액 0");
  attachAlts(items, alts);
  for (const p of ctx.partners) {
    const c = items.filter((x) => !x.partner && x.accounts.some(needsPartner));
    if (c.length === 1) c[0].partner = p; // 애매하면 거래처 없이 (채점에서 안 본다)
  }

  const answer: Answer = {
    lines: items.map((x) => ({
      side: x.side!,
      accounts: x.accounts,
      ...(x.partner ? { partner: x.partner } : {}),
      amount: x.amount,
    })),
  };
  const date = dateOf(units.slice(0, start + 1).map(joined).join("\n"));
  if (date) answer.date = date;

  if (category === "매입매출전표") {
    const head = units
      .slice(0, start)
      .map(joined)
      .concat(joined(first).split("(차)")[0])
      .join(" ");
    const h = parseHeader(head);
    if (!h) fail("매입매출 머리 해석 실패");
    answer.header = h!;
  }
  return answer;
}

/** 정답 원문 → 구조화. 확실하지 않으면 null */
export function parseAnswer(answerText: string, category: Menu): Answer | null {
  return explainParse(answerText, category).answer;
}

// ── 채점 ──────────────────────────────────────────────────
/** 학생 입력 */
export type Entry = { date?: string; header?: SalesHeader; lines: Line[] };

/** 채점 결과. issues는 학생에게 그대로 보여줄 한국어 문장 (예: "외상매출금의 거래처가 빠졌어요") */
export type GradeResult = { ok: boolean; issues: string[] };

/** 거래처 비교용: ㈜·(주)·공백·기호 제거 */
const normPartner = (s?: string) =>
  (s ?? "").replace(/㈜|\(주\)|주식회사|\(유\)|[\s.,·()\-]/g, "").toLowerCase();
const samePartner = (a?: string, b?: string) => {
  const x = normPartner(a);
  const y = normPartner(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
};

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
// 받침 유무로 조사 고르기 (괄호 접미사는 무시하고 마지막 한글 기준)
function josa(word: string, withB: string, without: string) {
  const ch = baseOf(word).match(/[가-힣](?=[^가-힣]*$)/)?.[0];
  if (!ch) return word + without;
  return word + ((ch.charCodeAt(0) - 0xac00) % 28 ? withB : without);
}

type AggA = { side: Side; accounts: string[]; partner?: string; amount: number; checkPartner: boolean };
type AggS = { side: Side; account: string; partner?: string; amount: number };

/** 채점. 줄 순서 무관, 같은 변·계정·거래처 금액은 합쳐서 비교 */
export function gradeEntry(entry: Entry, answer: Answer): GradeResult {
  const issues: string[] = [];

  // 학생 줄 합치기 (거래처는 채권·채무 계정만 구분)
  const stu: AggS[] = [];
  for (const l of entry.lines) {
    if (!l.account?.trim()) {
      if (l.amount) issues.push(`${l.side}변에 계정과목이 비어 있는 줄이 있어요`);
      continue;
    }
    const account = normalizeAccount(l.account);
    const partner = needsPartner(account) ? l.partner?.trim() || undefined : undefined;
    const hit = stu.find((s) => s.side === l.side && s.account === account && normPartner(s.partner) === normPartner(partner));
    if (hit) hit.amount += l.amount || 0;
    else stu.push({ side: l.side, account, partner, amount: l.amount || 0 });
  }
  const dSum = sumOf(stu.filter((s) => s.side === "차"));
  const cSum = sumOf(stu.filter((s) => s.side === "대"));
  if (dSum !== cSum) issues.push(`차변 합계(${won(dSum)})와 대변 합계(${won(cSum)})가 달라요`);

  // 정답 줄 합치기
  const ans: AggA[] = [];
  for (const l of answer.lines) {
    const accounts = l.accounts.map(normalizeAccount);
    const checkPartner = Boolean(l.partner) && accounts.some(needsPartner);
    const partner = checkPartner ? l.partner : undefined;
    const key = accounts.slice().sort().join("/");
    const hit = ans.find(
      (a) => a.side === l.side && a.accounts.slice().sort().join("/") === key && normPartner(a.partner) === normPartner(partner)
    );
    if (hit) hit.amount += l.amount;
    else ans.push({ side: l.side, accounts, partner, amount: l.amount, checkPartner });
  }

  const usedS = new Set<number>();
  const doneA = new Set<number>();
  const partnerOk = (a: AggA, s: AggS) => !a.checkPartner || samePartner(a.partner, s.partner);
  const pass = (fn: (a: AggA, s: AggS) => boolean, then: (a: AggA, s: AggS) => void) =>
    ans.forEach((a, ai) => {
      if (doneA.has(ai)) return;
      const si = stu.findIndex((s, k) => !usedS.has(k) && fn(a, s));
      if (si < 0) return;
      usedS.add(si);
      doneA.add(ai);
      then(a, stu[si]);
    });

  // 1) 완전 일치
  pass((a, s) => a.side === s.side && a.accounts.includes(s.account) && partnerOk(a, s) && a.amount === s.amount, () => {});
  // 2) 계정은 맞고 금액·거래처가 다름 (거래처 맞는 줄 우선)
  const detail = (a: AggA, s: AggS) => {
    if (a.amount !== s.amount) issues.push(`${s.account} 금액이 달라요 (정답 ${won(a.amount)})`);
    if (!partnerOk(a, s))
      issues.push(s.partner ? `${s.account}의 거래처가 달라요` : `${s.account}의 거래처를 입력해야 해요`);
  };
  pass((a, s) => a.side === s.side && a.accounts.includes(s.account) && partnerOk(a, s), detail);
  pass((a, s) => a.side === s.side && a.accounts.includes(s.account), detail);
  // 3) 판관비(8xx)/제조원가(5xx) 혼동
  pass(
    (a, s) => a.side === s.side && a.accounts.some((x) => baseOf(x) === baseOf(s.account)),
    (a, s) => {
      const want = a.accounts.find((x) => baseOf(x) === baseOf(s.account))!;
      const kind = want.endsWith("(판)") ? "판매비와관리비(800번대)" : want.endsWith("(제)") ? "제조원가(500번대)" : "영업외비용";
      issues.push(`${josa(baseOf(s.account), "은", "는")} ${kind} 계정으로 입력해야 해요`);
      if (a.amount !== s.amount) issues.push(`${baseOf(s.account)} 금액이 달라요 (정답 ${won(a.amount)})`);
    }
  );
  // 4) 차/대 반대
  pass(
    (a, s) => a.side !== s.side && a.accounts.includes(s.account),
    (a, s) => issues.push(`${josa(s.account, "은", "는")} ${s.side}변이 아니라 ${a.side}변이에요`)
  );
  // 5) 빠진 줄 / 필요 없는 줄
  ans.forEach((a, ai) => {
    if (!doneA.has(ai)) issues.push(`${a.side}변에 ${a.accounts[0]} ${won(a.amount)}이 빠졌어요`);
  });
  stu.forEach((s, si) => {
    if (!usedS.has(si)) issues.push(`${s.side}변의 ${josa(s.account, "은", "는")} 정답에 없는 계정이에요`);
  });

  // 매입매출 위쪽 칸
  const h = answer.header;
  if (h) {
    const e = entry.header;
    if (!e) issues.push("매입매출전표 위쪽 칸(유형·공급가액·부가세)을 입력해야 해요");
    else {
      const types = h.types?.length ? h.types : [h.type];
      if (!types.includes(e.type)) issues.push(`유형이 달라요 (정답 ${types.map(salesTypeLabel).join(" 또는 ")})`);
      if (e.supply !== h.supply) issues.push(`공급가액이 달라요 (정답 ${won(h.supply)})`);
      if (e.vat !== h.vat) issues.push(`부가세가 달라요 (정답 ${won(h.vat)})`);
      if (h.partner && !samePartner(h.partner, e.partner))
        issues.push(e.partner?.trim() ? "거래처가 달라요" : "거래처를 입력해야 해요");
      if (h.electronic !== undefined && e.electronic !== undefined && h.electronic !== e.electronic)
        issues.push(`전자 여부가 달라요 (정답 ${h.electronic ? "여" : "부"})`);
    }
  }
  if (answer.date && entry.date && answer.date !== entry.date) issues.push("거래 날짜가 달라요");

  return { ok: issues.length === 0, issues };
}
