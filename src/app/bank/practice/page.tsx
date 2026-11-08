"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import { StemView, ExplanationView, TAG, TAG_FILL } from "@/components/BankQuestion";
import LedgerGrid, { initialForm, toEntry, type LedgerForm } from "@/components/LedgerGrid";
import { GRADES, MENUS, SALES_TYPES, parseAnswer, gradeEntry, type Answer, type Grade, type GradeResult, type Menu } from "@/lib/ledger";

// 실무 연습 — 기출 실무 문제를 KcLep 비슷한 전표 입력판에 직접 쳐 보고 자동 채점한다.
// 기존 "한 문제씩"의 실무는 정답을 보고 스스로 맞았는지 고르는 자가채점이라, 손으로 입력해 보는 연습이 없었다.
// 급수·메뉴는 URL(?g=&m=)에 둔다 — 새로고침·공유해도 같은 화면.
// 정답 원문이 제각각이라 parseAnswer가 확실히 읽은 문항만 낸다(틀린 정답으로 채점하느니 빼는 게 낫다).

type Practice = {
  id: string;
  type: "practice";
  stem: string;
  answerText: string | null;
  explanation: string | null;
  area: string;
  typeTag: string;
  source?: string | null; // 회차 (예: "전산회계2급 124회")
  images?: string[] | null;
};
type Item = { q: Practice; answer: Answer };

// 지문 맨 앞 "07월 05일"에서 월·일 — 결산은 12월 31일 고정
function dateOf(stem: string, menu: Menu): { month: string; day: string } {
  if (menu === "결산") return { month: "12", day: "31" };
  const m = stem.match(/^\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? { month: m[1], day: "" } : { month: "", day: "" };
}

export default function PracticePage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <PracticeInner />
    </Suspense>
  );
}

function PracticeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { session, gate } = useGate("any", { loginMessage: "실무 연습은 로그인 후 쓸 수 있어요." });
  const token = session?.access_token;

  const g0 = params.get("g") as Grade | null;
  const grade: Grade = g0 && GRADES.includes(g0) ? g0 : GRADES[0];
  const m0 = params.get("m") as Menu | null;
  const menu: Menu = m0 && MENUS[grade].includes(m0) ? m0 : MENUS[grade][0];

  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<LedgerForm>(initialForm());
  const [result, setResult] = useState<GradeResult | null>(null);
  const [revealed, setRevealed] = useState(false);
  // 세션 점수 — 문제마다 첫 채점만 센다 (고쳐서 다시 맞히는 건 연습이지 점수가 아니다)
  const [score, setScore] = useState({ right: 0, tried: 0 });
  const triedRef = useRef(new Set<string>());
  const reqRef = useRef(0); // 급수를 빨리 바꿀 때 늦게 온 이전 응답이 덮지 않게

  const item = items?.[idx] ?? null;
  const date = item ? dateOf(item.q.stem, menu) : { month: "", day: "" };

  function select(g: Grade, m: Menu) {
    router.replace(`/bank/practice?g=${encodeURIComponent(g)}&m=${encodeURIComponent(m)}`, { scroll: false });
  }

  function openQuestion(list: Item[], i: number) {
    setIdx(i);
    setForm(initialForm(list[i] ? dateOf(list[i].q.stem, menu).day : ""));
    setResult(null);
    setRevealed(false);
  }

  async function load() {
    if (!token) return;
    const my = ++reqRef.current;
    setBusy(true);
    setErr("");
    const p = new URLSearchParams({ subject: grade, category: menu, limit: "50" });
    const r = await fetch(`/api/bank?${p}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (my !== reqRef.current) return;
    setBusy(false);
    if (!r?.ok) return setErr(d?.error ?? "문제를 불러오지 못했어요.");
    const list: Item[] = [];
    for (const q of (d.questions ?? []) as Practice[]) {
      if (q.type !== "practice" || !q.answerText) continue;
      const answer = parseAnswer(q.answerText, menu);
      if (answer) list.push({ q, answer });
    }
    setItems(list);
    openQuestion(list, 0);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async 함수라 setState는 await 이후, 동기 캐스케이드 아님
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 급수·메뉴(URL)가 바뀔 때만 새 세트
  }, [token, grade, menu]);

  function gradeIt() {
    if (!item) return;
    const res = gradeEntry(toEntry(form, date.month, menu === "매입매출전표"), item.answer);
    setResult(res);
    if (!triedRef.current.has(item.q.id)) {
      triedRef.current.add(item.q.id);
      setScore((s) => ({ right: s.right + (res.ok ? 1 : 0), tried: s.tried + 1 }));
    }
  }

  function next() {
    if (!items) return;
    if (idx + 1 < items.length) openQuestion(items, idx + 1);
    else load(); // 세트를 다 풀면 새로 받아 온다
    window.scrollTo({ top: 0 });
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 lg:px-6 py-6 lg:py-8 flex flex-col gap-4 lg:gap-5">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-bold">실무 연습</h1>
          <p className="text-sub text-[15px] break-keep">기출 실무 문제를 전표 입력판에 직접 쳐 보고 바로 채점해요. 입력 순서는 KcLep과 같아요.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip h-10 !text-[14px] !font-bold inline-flex items-center tabular-nums" style={{ color: "var(--text)" }} aria-live="polite">
            맞힌 문제 {score.right} / {score.tried}
          </span>
          <Link href="/bank" className="chip h-10 !text-[14px] !font-bold inline-flex items-center" style={{ color: "var(--text)" }}>
            기출문제
          </Link>
        </div>
      </div>

      {/* 급수 · 메뉴 */}
      <section className="rise d1 card p-4 lg:p-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="급수">
          <span className="text-[14px] font-bold w-10 shrink-0">급수</span>
          {GRADES.map((g) => (
            <button
              key={g}
              onClick={() => select(g, MENUS[g].includes(menu) ? menu : MENUS[g][0])}
              aria-pressed={g === grade}
              className={`chip min-h-10 ${g === grade ? "chip-on" : ""}`}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="메뉴">
          <span className="text-[14px] font-bold w-10 shrink-0">메뉴</span>
          {MENUS[grade].map((m) => (
            <button key={m} onClick={() => select(grade, m)} aria-pressed={m === menu} className={`chip min-h-10 ${m === menu ? "chip-on" : ""}`}>
              {m === "결산" ? "결산(12월 31일)" : `${m}입력`}
            </button>
          ))}
          <button onClick={load} disabled={busy} className="chip min-h-10 ml-auto !font-bold disabled:opacity-40" style={{ color: "var(--text)" }}>
            새 문제 세트
          </button>
        </div>
      </section>

      {err && (
        <p className="text-[14px] font-semibold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
      {busy && !item && <div className="card p-6 text-sub text-[14px]">문제를 불러오는 중…</div>}
      {!busy && items && !items.length && !err && (
        <div className="card p-6 text-[14px] text-sub break-keep">
          이 급수·메뉴에는 자동 채점할 수 있는 문제가 아직 없어요. 다른 메뉴를 골라 보세요.
        </div>
      )}

      {item && (
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:items-start">
          {/* 문제 */}
          <section className="rise d2 card p-5 flex flex-col gap-3 xl:sticky xl:top-[76px] xl:max-h-[calc(100vh-96px)] xl:overflow-auto">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={TAG} style={TAG_FILL}>
                {idx + 1} / {items!.length}
              </span>
              <span className={TAG} style={TAG_FILL}>{item.q.source || grade}</span>
              {item.q.typeTag && <span className={TAG} style={TAG_FILL}>{item.q.typeTag}</span>}
            </div>
            <StemView stem={item.q.stem} images={item.q.images} />
          </section>

          {/* 입력판 + 채점 */}
          <div className="flex flex-col gap-4 min-w-0">
            <section className="card p-4 lg:p-5 min-w-0" aria-label={`${menu} 입력`}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="font-bold text-[17px]">{menu === "결산" ? "결산 (일반전표입력)" : `${menu}입력`}</h2>
                <span className="hidden md:inline text-[12px] text-sub">Enter 다음 칸 · F2 코드 도움 · F5 줄 삭제</span>
              </div>
              <LedgerGrid
                key={item.q.id}
                value={form}
                onChange={setForm}
                month={date.month}
                sales={menu === "매입매출전표"}
                lockDay={menu === "결산"}
              />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                <button onClick={gradeIt} className="btn btn-primary h-[48px] text-[16px] col-span-2 sm:col-span-1">
                  채점하기
                </button>
                <button onClick={() => setRevealed((v) => !v)} className="btn btn-ghost h-[48px] text-[15px]">
                  {revealed ? "정답 숨기기" : "정답 보기"}
                </button>
                <button
                  onClick={() => {
                    setForm(initialForm(date.day));
                    setResult(null);
                  }}
                  className="btn btn-gray h-[48px] text-[15px]"
                >
                  다시 풀기
                </button>
                <button onClick={next} disabled={busy} className="btn btn-gray h-[48px] text-[15px] col-span-2 sm:col-span-1">
                  다음 문제
                </button>
              </div>
            </section>

            {result && (
              <section
                className="card p-5"
                aria-live="polite"
                style={{ borderColor: result.ok ? "var(--green)" : "var(--red)", background: result.ok ? "var(--green-weak)" : "var(--red-weak)" }}
              >
                <p className="text-[16px] font-bold" style={{ color: result.ok ? "var(--green)" : "var(--red)" }}>
                  {result.ok ? "✓ 정답이에요" : "다시 확인해 보세요"}
                </p>
                {!result.ok && result.issues.length > 0 && (
                  <ul className="mt-2 text-[14px] leading-[1.7] list-disc pl-[18px] break-keep" style={{ color: "var(--text-2)" }}>
                    {result.issues.map((s, k) => (
                      <li key={k}>{s}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {revealed && <AnswerCard answer={item.answer} explanation={item.q.explanation} />}
          </div>
        </div>
      )}
    </main>
  );
}

// 정답 — 원문(answer_text)엔 [[표]] 토큰이 섞여 있어 파싱된 정답을 그린다. 채점 기준과 화면이 같아야 헷갈리지 않는다
function AnswerCard({ answer, explanation }: { answer: Answer; explanation: string | null }) {
  const h = answer.header;
  const typeName = (c: string) => `${c}.${SALES_TYPES.find((t) => t.code === c)?.name ?? ""}`;
  const side = (s: "차" | "대") => answer.lines.filter((l) => l.side === s);
  return (
    <section className="card p-5 flex flex-col gap-3">
      <p className="text-[14px] font-bold" style={{ color: "var(--sub-2)" }}>
        정답{answer.date ? ` · ${answer.date.replace("-", "월 ")}일` : ""}
      </p>
      {h && (
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[13px]">
          {[
            ["유형", (h.types?.length ? h.types : [h.type]).map(typeName).join(" 또는 ")],
            ["공급가액", h.supply.toLocaleString("ko-KR")],
            ["부가세", h.vat.toLocaleString("ko-KR")],
            ["거래처", h.partner ?? "—"],
            ["전자", h.electronic === undefined ? "—" : h.electronic ? "여" : "부"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[8px] px-3 py-2" style={{ background: "var(--fill-2)" }}>
              <dt className="text-sub text-[12px]">{k}</dt>
              <dd className="font-semibold break-keep">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid grid-cols-2 rounded-[10px] p-3.5 text-[14px] leading-relaxed" style={{ background: "var(--fill-2)" }}>
        {(["차", "대"] as const).map((s) => (
          <div
            key={s}
            className={`flex flex-col gap-0.5 min-w-0 ${s === "대" ? "pl-3" : "pr-3"}`}
            style={s === "대" ? { borderLeft: "1.5px solid color-mix(in srgb, var(--sub) 45%, transparent)" } : undefined}
          >
            {side(s).map((l, k) => (
              <div key={k} className="break-words">
                {k === 0 ? `(${s}) ` : ""}
                {l.accounts.join(" 또는 ")}
                {l.partner ? `(${l.partner})` : ""} {l.amount.toLocaleString("ko-KR")}원
              </div>
            ))}
          </div>
        ))}
      </div>
      {explanation && (
        <>
          <p className="text-[14px] font-bold" style={{ color: "var(--sub-2)" }}>해설</p>
          <ExplanationView text={explanation} />
        </>
      )}
    </section>
  );
}

