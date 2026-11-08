// 실무 연습(src/lib/ledger.ts) 셀프체크 — 정답 파싱·채점·계정 검색.
//   npx tsx scripts/test-ledger.ts              # 단위 검증 (+ .env.local 있으면 문제은행 파싱 커버리지)
//   npx tsx scripts/test-ledger.ts --spot 20    # 커버리지 + 파싱 성공 문항 20개를 원문과 나란히 출력 (눈 검수)
//
// 커버리지는 bank_questions를 **읽기만** 한다 (실사용 중인 표 — 쓰기 금지).
import assert from "node:assert";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  ACCOUNTS,
  findAccounts,
  SALES_TYPES,
  ZERO_VAT,
  vatRate,
  parseAnswer,
  explainParse,
  gradeEntry,
  type Answer,
  type Entry,
  type Menu,
} from "../src/lib/ledger";

let pass = 0;
let failCnt = 0;
function ok(name: string, cond: boolean, detail = "") {
  if (cond) pass++;
  else {
    failCnt++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const lines = (a: Answer | null) =>
  a
    ? a.lines
        .map((l) => `${l.side} ${l.accounts.join("|")}${l.partner ? `[${l.partner}]` : ""} ${l.amount}`)
        .sort()
        .join(" / ")
    : "null";
function parses(name: string, text: string, cat: Menu, want: string[]) {
  const a = parseAnswer(text, cat);
  const got = lines(a);
  ok(name, got === want.slice().sort().join(" / "), got);
  return a;
}

// ── 계정과목표 ──
{
  const codes = new Set<string>();
  for (const a of ACCOUNTS) {
    ok(`코드 중복 없음 ${a.code}`, !codes.has(a.code));
    codes.add(a.code);
  }
  const by = (c: string) => ACCOUNTS.find((a) => a.code === c);
  ok("101 현금", by("101")?.name === "현금" && by("101")?.group === "자산");
  ok("811 복리후생비(판)", by("811")?.name === "복리후생비(판)" && by("811")?.group === "비용");
  ok("511 복리후생비(제)", by("511")?.name === "복리후생비(제)");
  ok("108 외상매출금 거래처 필요", by("108")?.needsPartner === true);
  ok("103 보통예금 거래처 불필요", !by("103")?.needsPartner);
  ok("951 이자비용", by("951")?.name === "이자비용");

  const f = findAccounts("복리후생비").map((a) => a.code);
  ok("검색: 복리후생비 → 판·제 둘 다, 판 먼저", f[0] === "811" && f.includes("511"), f.join(","));
  ok("검색: 복리 → 811이 511보다 앞", findAccounts("복리")[0]?.code === "811");
  ok("검색: 코드 앞자리 10", findAccounts("10").every((a) => a.code.startsWith("10")));
  ok("검색: 접대비 → 기업업무추진비", findAccounts("접대비").some((a) => a.name === "기업업무추진비(판)"));
  ok("검색: 30개 상한", findAccounts("금").length <= 30);
  ok("검색: 빈 문자열", findAccounts(" ").length === 0);

  ok("유형 21개", SALES_TYPES.length === 21);
  ok("유형 54 불공 매입", SALES_TYPES.find((t) => t.code === "54")?.kind === "매입");
  ok("부가세율", vatRate("11") === 0.1 && vatRate("12") === 0 && vatRate("53") === 0 && vatRate("54") === 0.1);
  ok("ZERO_VAT 면세 포함", ZERO_VAT.has("13") && ZERO_VAT.has("62") && !ZERO_VAT.has("55"));
}

// ── 정답 파싱 (문제은행 실제 표기들) ──
parses(
  "평문 + 거래처 앞 공백",
  "(차) 인출금  1,000,000원              (대) 미지급금  (국민카드)  1,000,000원",
  "일반전표",
  ["차 인출금 1000000", "대 미지급금[국민카드] 1000000"]
);
const a2 = parses(
  "이어지는 줄 — 대차평형으로 열 복원",
  "일반전표입력\n2025.07.05. (차) 현금 1,000,000원 (대) 상품매출 5,000,000원\n외상매출금(한마음상사) 4,000,000원",
  "일반전표",
  ["차 현금 1000000", "대 상품매출 5000000", "차 외상매출금[한마음상사] 4000000"]
);
ok("날짜 MM-DD", a2?.date === "07-05", a2?.date);
parses(
  "[일반전표입력] 머리",
  "[일반전표입력]\n2025.09.02. (차) 차량운반구 14,500,000원 (대) 보통예금 14,000,000원\n현금 500,000원",
  "일반전표",
  ["차 차량운반구 14500000", "대 보통예금 14000000", "대 현금 500000"]
);
parses(
  "(또는 X) — 같은 그룹 항목에 붙는다",
  "(차) 미지급세금 8,500,000원 (대) 미지급금(국민카드) 8,568,000원\n세금과공과(판) 68,000원 (또는 미지급비용)",
  "일반전표",
  ["차 미지급세금 8500000", "대 미지급금|미지급비용[국민카드] 8568000", "차 세금과공과(판) 68000"]
);
const s1 = parses(
  "매입매출 표 머리 + 표 분개",
  "[[표]]유형:|55.수입|공급가액:|2,000,000|원|부가세:|200,000|원|거래처:|인천세관|전자:|여|분개:현금 또는 혼합[[/표]]\n[[표]](차)|부가세대급금|200,000원|(대)|현금|200,000원[[/표]]",
  "매입매출전표",
  ["차 부가세대급금 200000", "대 현금 200000"]
);
ok(
  "매입매출 머리 55",
  JSON.stringify(s1?.header) ===
    JSON.stringify({ type: "55", types: ["55"], supply: 2000000, vat: 200000, partner: "인천세관", electronic: true }),
  JSON.stringify(s1?.header)
);
const s2 = parses(
  "매입매출 평문 머리 (52 영세, ㈜항원)",
  "유형 : 52 영세, 공급가액 : 20,000,000원, 부가세 : 0원, 거래처 : ㈜항원, 전자 : 여, 분개 : 혼합\n(차) 상품 20,000,000원 (대) 보통예금 20,000,000원",
  "매입매출전표",
  ["차 상품 20000000", "대 보통예금 20000000"]
);
ok("거래처 이름 끝 '원'을 단위로 자르지 않음", s2?.header?.partner === "㈜항원", s2?.header?.partner);
ok("52 영세 부가세 0", s2?.header?.type === "52" && s2?.header?.vat === 0);
parses("분개 줄 거래처 끝 '원'", "(차) 비품 1,000원 (대) 미지급금(항원) 1,000원", "일반전표", [
  "차 비품 1000",
  "대 미지급금[항원] 1000",
]);
const s3 = parses(
  "수출 — 부가세 칸 없음 → 0",
  "유형:16.수출 공급가액:3,000,000원 거래처:BTECH 분개:외상 또는 혼합\n영세율구분:①직접수출(대행수출 포함) 수출신고번호:12345-00-123456X\n2023.04.09. (차) 외상매출금 3,000,000원 (대) 제품매출 3,000,000원",
  "매입매출전표",
  ["차 외상매출금 3000000", "대 제품매출 3000000"]
);
ok("16 수출 머리", s3?.header?.type === "16" && s3?.header?.vat === 0 && s3?.header?.partner === "BTECH");
parses(
  "표 안 여러 항목 + (판)",
  "[[표]]2022.10.13.|(차)|받을어음(발해상사) 1,200,000 외상매출금(발해상사) 1,100,000|원|(대)|상품매출 2,300,000|원[[/표]]",
  "일반전표",
  ["차 받을어음[발해상사] 1200000", "차 외상매출금[발해상사] 1100000", "대 상품매출 2300000"]
);
parses(
  "표 열 위치로 차/대 + 코드 괄호",
  "[[표]]07월 01일|(차)|감가상각누계액(207) 15,000,000|원|(대)|기계장치 35,000,000|원∥||국고보조금(217) 10,000,000|원||부가세예수금 1,200,000|원∥||보통예금 7,700,000|원||유형자산처분이익 2,000,000|원∥||미수금 5,500,000|원|||[[/표]]",
  "일반전표",
  [
    "차 감가상각누계액 15000000",
    "차 국고보조금 10000000",
    "차 보통예금 7700000",
    "차 미수금 5500000",
    "대 기계장치 35000000",
    "대 부가세예수금 1200000",
    "대 유형자산처분이익 2000000",
  ]
);
parses(
  "표 '또는 접대비(제)' + 적요 + 접대비→기업업무추진비",
  "[[표]](차)|접대비(판)|570,000원|||(대)|제품(적요8. 타계정대체)|500,000원∥|또는 접대비(제)|||||부가세예수금|70,000원[[/표]]",
  "일반전표",
  ["차 기업업무추진비(판)|기업업무추진비(제) 570000", "대 제품 500000", "대 부가세예수금 70000"]
);
parses("출금전표 대체 입력은 버린다", "일반전표입력\n2025.12.12. (차) 통신비 100,000원 (대) 현금 100,000원\n또는, (출금전표) 통신비 100,000원", "일반전표", [
  "차 통신비(제)|통신비(판) 100000",
  "대 현금 100000",
]);
parses(
  "입금전표 대체의 이어지는 줄도 버린다",
  "(차) 현금 770,000원 (대) 부가세예수금 70,000원\n제품매출 700,000원\n또는, (입금전표) 부가세예수금 70,000원\n제품매출 700,000원",
  "일반전표",
  ["차 현금 770000", "대 부가세예수금 70000", "대 제품매출 700000"]
);
parses("(결차)/(결대)", "(결차) 상품매출원가  143,120,000원      (결대) 상품  143,120,000원", "결산", [
  "차 상품매출원가 143120000",
  "대 상품 143120000",
]);
parses("'차)' 여는 괄호 빠짐 + 각주", "차) 보통예금 34,200,000원(주1) 대) 외상매출금 34,200,000원\n(주1)₩1×34,200,000원", "일반전표", [
  "차 보통예금 34200000",
  "대 외상매출금 34200000",
]);
parses("코드 대체 (984 또는 831)", "(차)수수료비용(984 또는 831) 1,500원 (대) 현금 1,500원", "일반전표", [
  "차 수수료비용|수수료비용(판) 1500",
  "대 현금 1500",
]);
parses("음수 금액 (수정세금계산서)", "(차) 외상매출금 -3,300,000원 (대) 제품매출 -3,000,000원\n부가세예수금 -300,000원", "일반전표", [
  "차 외상매출금 -3300000",
  "대 제품매출 -3000000",
  "대 부가세예수금 -300000",
]);
parses("금액 뒤 거래처 괄호", "(차) 외화환산손실 1,000,000원 (대) 외상매출금 1,000,000원(미국 abc)", "결산", [
  "차 외화환산손실 1000000",
  "대 외상매출금[미국 abc] 1000000",
]);

// null이어야 하는 것들
const nulls: [string, string, Menu][] = [
  ["대차 불일치", "(차) 현금 1,000원 (대) 상품매출 2,000원", "일반전표"],
  ["분개 두 개", "(차) 현금 1,000원 (대) 상품매출 1,000원\n(차) 이자비용 500원 (대) 현금 500원", "일반전표"],
  ["대체 분개", "(차) 상품매출 200,000원 (대) 외상매출금 200,000원\n또는 (차) 매출환입및에누리 200,000원 (대) 외상매출금 200,000원", "일반전표"],
  ["결산자료입력", "[결산자료입력]＞2.매출원가＞기말 원재료 재고액：5,000,000원 입력＞ 전표추가", "결산"],
  ["모르는 계정", "(차) 뭐시기계정 1,000원 (대) 현금 1,000원", "일반전표"],
  ["매입매출 머리 없음", "(차) 상품 1,000원 (대) 현금 1,000원", "매입매출전표"],
  ["복원 불확실(해 여러 개)", "(차) 현금 1,000원 (대) 상품매출 1,000원\n이자수익 500원\n잡이익 500원", "일반전표"],
];
for (const [n, t, c] of nulls) ok(`null: ${n}`, parseAnswer(t, c) === null, lines(parseAnswer(t, c)));

// ── 채점 ──
{
  const ans = parseAnswer(
    "2025.07.05. (차) 현금 1,000,000원 (대) 상품매출 5,000,000원\n외상매출금(한마음상사) 4,000,000원",
    "일반전표"
  )!;
  const base: Entry = {
    lines: [
      { side: "차", account: "현금", amount: 1000000 },
      { side: "차", account: "외상매출금", partner: "한마음상사", amount: 4000000 },
      { side: "대", account: "상품매출", amount: 5000000 },
    ],
  };
  const g = (e: Entry, a = ans) => gradeEntry(e, a);
  ok("채점: 정답", g(base).ok, g(base).issues.join(" | "));
  ok("채점: 순서 무관", g({ lines: base.lines.slice().reverse() }).ok);
  ok(
    "채점: 같은 계정 나눠 적어도 합산",
    g({
      lines: [
        base.lines[0],
        { side: "차", account: "외상매출금", partner: "(주)한마음상사", amount: 1000000 },
        { side: "차", account: "외상매출금", partner: "한마음 상사", amount: 3000000 },
        base.lines[2],
      ],
    }).ok
  );
  const noP = g({ lines: [base.lines[0], { ...base.lines[1], partner: undefined }, base.lines[2]] });
  ok("채점: 거래처 빠짐", !noP.ok && noP.issues.includes("외상매출금의 거래처를 입력해야 해요"), noP.issues.join(" | "));
  const wrongP = g({ lines: [base.lines[0], { ...base.lines[1], partner: "다른상사" }, base.lines[2]] });
  ok("채점: 거래처 다름", wrongP.issues.includes("외상매출금의 거래처가 달라요"), wrongP.issues.join(" | "));
  const amt = g({
    lines: [
      { side: "차", account: "현금", amount: 2000000 },
      { side: "차", account: "외상매출금", partner: "한마음상사", amount: 3000000 },
      base.lines[2],
    ],
  });
  ok(
    "채점: 금액 다름",
    amt.issues.includes("현금 금액이 달라요 (정답 1,000,000원)") &&
      amt.issues.includes("외상매출금 금액이 달라요 (정답 4,000,000원)"),
    amt.issues.join(" | ")
  );
  const miss = g({ lines: [{ side: "차", account: "현금", amount: 5000000 }, base.lines[2]] });
  ok(
    "채점: 빠진 줄",
    miss.issues.includes("차변에 외상매출금 4,000,000원이 빠졌어요"),
    miss.issues.join(" | ")
  );
  const extra = g({ lines: [...base.lines, { side: "차", account: "보통예금", amount: 0 }] });
  ok("채점: 필요 없는 줄", extra.issues.includes("차변의 보통예금은 정답에 없는 계정이에요"), extra.issues.join(" | "));
  const side = g({
    lines: [
      { side: "대", account: "현금", amount: 1000000 },
      base.lines[1],
      base.lines[2],
    ],
  });
  ok("채점: 차/대 반대", side.issues.some((s) => s.startsWith("현금은 대변이 아니라 차변")), side.issues.join(" | "));
  ok("채점: 대차 불일치 안내", side.issues[0]?.startsWith("차변 합계"), side.issues[0]);

  // 대체 계정 인정
  const alt = parseAnswer("(차) 미지급세금 8,500,000원 (대) 미지급금(국민카드) 8,568,000원\n세금과공과(판) 68,000원 (또는 미지급비용)", "일반전표")!;
  const altE = (acc: string): Entry => ({
    lines: [
      { side: "차", account: "미지급세금", amount: 8500000 },
      { side: "차", account: "세금과공과(판)", amount: 68000 },
      { side: "대", account: acc, partner: "국민카드", amount: 8568000 },
    ],
  });
  ok("채점: 대체 계정(미지급비용) 인정", g(altE("미지급비용"), alt).ok, g(altE("미지급비용"), alt).issues.join(" | "));
  ok("채점: 원래 계정(미지급금)도 정답", g(altE("미지급금"), alt).ok);

  // 판/제 — 엄격. 구체적인 안내
  const pj = parseAnswer("(차) 복리후생비(판) 100,000원 (대) 현금 100,000원", "일반전표")!;
  const pjr = g({ lines: [{ side: "차", account: "복리후생비(제)", amount: 100000 }, { side: "대", account: "현금", amount: 100000 }] }, pj);
  ok("채점: 판/제 혼동은 오답", !pjr.ok);
  ok(
    "채점: 판/제 안내 문구",
    pjr.issues.includes("복리후생비는 판매비와관리비(800번대) 계정으로 입력해야 해요"),
    pjr.issues.join(" | ")
  );
  // 정답이 (판)/(제)를 안 적었으면 둘 다 인정
  const np = parseAnswer("(차) 통신비 100,000원 (대) 현금 100,000원", "일반전표")!;
  ok(
    "채점: 원문에 판/제 없으면 둘 다 인정",
    g({ lines: [{ side: "차", account: "통신비(제)", amount: 100000 }, { side: "대", account: "현금", amount: 100000 }] }, np).ok
  );
  // 접대비 = 기업업무추진비
  const ent = parseAnswer("(차) 접대비(판) 50,000원 (대) 현금 50,000원", "일반전표")!;
  ok(
    "채점: 접대비=기업업무추진비",
    g({ lines: [{ side: "차", account: "기업업무추진비(판)", amount: 50000 }, { side: "대", account: "현금", amount: 50000 }] }, ent).ok
  );

  // 매입매출 머리
  const h = s1!;
  const hl = h.lines.map((l) => ({ side: l.side, account: l.accounts[0], amount: l.amount }));
  const he = (header: Entry["header"]) => g({ header, lines: hl }, h);
  ok("채점: 머리 정답", he({ type: "55", supply: 2000000, vat: 200000, partner: "인천세관", electronic: true }).ok);
  const hw = he({ type: "51", supply: 2000000, vat: 20000, partner: "부산세관" });
  ok(
    "채점: 머리 오답 안내",
    hw.issues.includes("유형이 달라요 (정답 55.수입)") &&
      hw.issues.includes("부가세가 달라요 (정답 200,000원)") &&
      hw.issues.includes("거래처가 달라요"),
    hw.issues.join(" | ")
  );
  ok("채점: 머리 빠짐", he(undefined).issues.some((s) => s.includes("위쪽 칸")));
}

// ── 커버리지 (문제은행 실데이터, 읽기 전용) ──
async function coverage(spot: number) {
  config({ path: ".env.local" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("\n(커버리지 건너뜀 — .env.local 없음)");
    return;
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  type Row = { id: string; subject: string; category: string; answer_text: string | null };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("bank_questions")
      .select("id,subject,category,answer_text")
      .in("subject", ["전산회계2급", "전산회계1급", "전산세무2급", "전산세무1급"])
      .in("category", ["일반전표", "매입매출전표", "결산"])
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }
  const stat: Record<string, { n: number; ok: number; why: Record<string, number> }> = {};
  const unknown: Record<string, number> = {};
  const good: Row[] = [];
  for (const r of rows) {
    const k = `${r.subject} ${r.category}`;
    const s = (stat[k] ??= { n: 0, ok: 0, why: {} });
    s.n++;
    const e = explainParse(r.answer_text ?? "", r.category as Menu);
    for (const u of e.unknown) unknown[u] = (unknown[u] ?? 0) + 1;
    if (e.answer) {
      s.ok++;
      good.push(r);
    }
    else {
      const w = (e.reason ?? "?").replace(/:.*/, "");
      s.why[w] = (s.why[w] ?? 0) + 1;
    }
  }
  console.log(`\n문제은행 파싱 커버리지 (${rows.length}문항)`);
  for (const [k, s] of Object.entries(stat).sort())
    console.log(`  ${k.padEnd(16)} ${String(s.ok).padStart(4)}/${String(s.n).padEnd(4)} ${((100 * s.ok) / s.n).toFixed(0).padStart(3)}%  ${JSON.stringify(s.why)}`);
  const top = Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log(`  표에 없는 계정명(상위): ${top.map(([k, v]) => `${k}×${v}`).join(", ") || "없음"}`);
  // 일반전표·매입매출은 85% 이상이어야 한다
  for (const [k, s] of Object.entries(stat))
    if (!k.endsWith("결산")) ok(`커버리지 ${k} ≥ 85%`, s.ok / s.n >= 0.85, `${((100 * s.ok) / s.n).toFixed(0)}%`);

  for (let i = 0; i < spot && good.length; i++) {
    const r = good[Math.floor(Math.random() * good.length)];
    const a = parseAnswer(r.answer_text ?? "", r.category as Menu)!;
    console.log(`\n── ${r.subject} ${r.category} ${r.id.slice(0, 8)}\n${(r.answer_text ?? "").slice(0, 400)}`);
    if (a.header) console.log(`  ⇒ 머리 ${JSON.stringify(a.header)}`);
    for (const l of a.lines)
      console.log(`  ⇒ ${l.side} ${l.accounts.join(" | ")}${l.partner ? ` [${l.partner}]` : ""} ${l.amount.toLocaleString("ko-KR")}`);
  }
}

const spotAt = process.argv.indexOf("--spot");
coverage(spotAt > 0 ? Number(process.argv[spotAt + 1] ?? 20) : 0)
  .then(() => {
    console.log(`\n${pass} 통과, ${failCnt} 실패`);
    assert.strictEqual(failCnt, 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
