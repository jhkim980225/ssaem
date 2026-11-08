"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import JournalEntry from "@/components/JournalEntry";
import CbtRunner, { type CbtQuestion } from "@/components/CbtRunner";
import {
  StemView,
  ExplanationView,
  ChoiceView,
  TAG,
  TAG_FILL,
  TAG_ON,
  CHOICE_BOX,
  CHOICE_NUM,
  choiceTone,
} from "@/components/BankQuestion";
import BankStats, { type BankStatsData } from "@/components/BankStats";
import { ExcelTry } from "@/components/ExcelPad";

// answerIdx·explanation은 공부 모드에서만 함께 온다
type Theory = { id: string; type: "theory"; stem: string; choices: string[]; area: string; typeTag: string; images?: string[] | null; answerIdx?: number; explanation?: string | null };
type Practice = {
  id: string;
  type: "practice";
  stem: string;
  answerText: string | null;
  explanation: string | null;
  area: string;
  typeTag: string;
  images?: string[] | null;
};
type Q = Theory | Practice;
type TreeRow = { subject: string; area: string; category: string; type_tag: string; count: number };
type SourceRow = { subject: string; source: string; count: number };

// 한 세션에 풀 문항 수 — 빠른 선택
const COUNTS = [5, 10, 15, 20, 30, 40] as const; // 40 = 컴활 필기 한 회분
// 회차 정렬·표기. 회계는 통산 회차("전산회계1급 125회"), 컴활은 해마다 1회부터("컴활2급 2020년 2회")라
// 숫자 하나만 뽑으면 연도가 사라져 "2회"가 여덟 개 생긴다 — 연도가 있으면 연도까지 본다
const YEAR_ROUND = /(\d{4})년\s*(\d+)회/;
const roundKey = (s: string) => {
  const y = s.match(YEAR_ROUND);
  return y ? Number(y[1]) * 10 + Number(y[2]) : Number((s.match(/(\d+)\s*회/) ?? [])[1] ?? 0);
};
const roundLabel = (s: string) => {
  const y = s.match(YEAR_ROUND);
  if (y) return `${y[1]}년 ${y[2]}회`;
  const n = (s.match(/(\d+)\s*회/) ?? [])[1];
  return n ? `${n}회` : s;
};

// 유형 표시 순서 — 급수마다 있는 유형이 다르므로(세무: 매입매출전표 있음) 목록은 트리에서 동적으로 뽑는다
const CATEGORY_ORDER = ["이론", "일반전표", "매입매출전표", "결산"];
// 영역 표시 순서 (목록에 없는 영역은 맨 뒤)
const AREA_ORDER = ["재무회계", "원가회계", "부가가치세", "소득세", "법인세", "컴퓨터 일반", "스프레드시트 일반"];
// 과목 "전체" 선택 — 전 과목 섞어서 출제 (API에는 all=1로 나간다)
const ALL = "전체";

export default function BankPage() {
  const { session, gate } = useGate("any", { loginMessage: "기출문제 풀이 기록은 계정에 저장돼요." });

  const [tree, setTree] = useState<TreeRow[] | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  // 영역 다중 선택 — 빈 배열 = 전체 영역
  const [areaSel, setAreaSel] = useState<string[]>([]);

  const [qs, setQs] = useState<Q[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [score, setScore] = useState({ right: 0, done: 0 });
  // 공부 모드: 정답·해설을 옆에 두고 넘겨보는 복습 모드 (채점 없음)
  const [study, setStudy] = useState(false);
  // CBT 모드 — 실제 시험처럼 번호판 보며 풀고 마지막에 일괄 채점 (이론 문항만)
  const [cbt, setCbt] = useState(true);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [source, setSource] = useState(""); // "" = 전체 회차 랜덤
  const [count, setCount] = useState<number>(15);
  const [cbtQs, setCbtQs] = useState<CbtQuestion[] | null>(null);

  // 오답노트 다시 풀기 세션 (기록은 subject "오답노트"로 남긴다 — 과목이 섞이므로)
  const [retryMode, setRetryMode] = useState(false);
  const retryStartedRef = useRef(false);
  // 완주 기록 중복 방지 (결과 화면 리렌더마다 저장되지 않게)
  const recordedRef = useRef(false);

  // 시험 기록 이름 검색 (같은 학원만 — 서버에서 테넌트 경계 강제)
  type Rec = { name?: string; subject: string; source: string | null; total: number; score: number; at: string };
  const [recName, setRecName] = useState("");
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [recStats, setRecStats] = useState<BankStatsData | null>(null);
  const [recBusy, setRecBusy] = useState(false);

  async function searchRecords() {
    const nm = recName.trim();
    if (!nm || recBusy || !token) return;
    setRecBusy(true);
    try {
      const h = { headers: { Authorization: `Bearer ${token}` } };
      const [r, sr] = await Promise.all([
        fetch(`/api/bank/records?name=${encodeURIComponent(nm)}`, h),
        fetch(`/api/bank/stats?name=${encodeURIComponent(nm)}`, h),
      ]);
      const d = await r.json().catch(() => null);
      setRecs(r.ok ? (d.records ?? []) : []);
      const sd = await sr.json().catch(() => null);
      setRecStats(sr.ok ? (sd.stats ?? null) : null);
    } finally {
      setRecBusy(false);
    }
  }

  // 이론 채점 상태
  const [picked, setPicked] = useState<number | null>(null);
  const [graded, setGraded] = useState<{ correct: boolean; answer: number; explanation: string } | null>(null);
  // 실무 자가채점 상태
  const [revealed, setRevealed] = useState(false);
  const [selfDone, setSelfDone] = useState(false);

  const token = session?.access_token;

  // 필터 트리
  useEffect(() => {
    if (!token) return;
    fetch("/api/bank", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setTree(d.tree ?? []);
        setSources(d.sources ?? []);
      })
      .catch(() => setTree([]));
  }, [token]);

  const subjects = useMemo(() => [...new Set((tree ?? []).map((t) => t.subject))].sort(), [tree]);
  // "전체"는 과목 필터 없음으로 취급 — 영역 목록·문항 수 집계 공용
  const subjFilter = subject === ALL ? "" : subject;
  const areas = useMemo(() => {
    const set = new Set(
      (tree ?? [])
        .filter((t) => (!subjFilter || t.subject === subjFilter) && (!category || t.category === category))
        .map((t) => t.area)
    );
    // 시험지 순서대로 — 집계 뷰는 순서가 없어 컴활이 "스프레드시트 일반 | 컴퓨터 일반"으로 뒤집혀 나왔다
    const rank = (a: string) => (AREA_ORDER.includes(a) ? AREA_ORDER.indexOf(a) : AREA_ORDER.length);
    return [...set].sort((a, b) => rank(a) - rank(b));
  }, [tree, subjFilter, category]);
  // 급수별 실제 존재하는 유형만 — 회계는 일반전표·결산, 세무는 매입매출전표까지
  const categories = useMemo(() => {
    const set = new Set(
      (tree ?? []).filter((t) => !subjFilter || t.subject === subjFilter).map((t) => t.category)
    );
    return [...set].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }, [tree, subjFilter]);

  function countFor(f: Partial<Pick<TreeRow, "subject" | "category" | "area">>): number {
    return (tree ?? [])
      .filter(
        (t) =>
          (!f.subject || t.subject === f.subject) &&
          (!f.category || t.category === f.category) &&
          (!f.area || t.area === f.area)
      )
      .reduce((s, t) => s + t.count, 0);
  }

  async function startWrong() {
    if (!token) return;
    setBusy(true);
    setErr("");
    const r = await fetch("/api/bank?mode=wrong&limit=15", {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(d?.error ?? "오답을 불러오지 못했어요.");
    if (!(d.questions ?? []).length) return setErr("다시 풀 오답이 없어요. 전부 맞혔거나 아직 푼 기록이 없어요.");
    setCbt(false);
    setStudy(false);
    setRetryMode(true);
    setQs(d.questions ?? []);
    setIdx(0);
    setScore({ right: 0, done: 0 });
    resetQ();
    recordedRef.current = false;
    enterRun();
  }

  // 오답노트에서 "다시 풀기"로 진입 (/bank?retry=wrong) — 틀린 문제만 한 문제씩 모드로
  useEffect(() => {
    if (!token || retryStartedRef.current) return;
    if (new URLSearchParams(window.location.search).get("retry") !== "wrong") return;
    retryStartedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async 함수라 setState는 await 이후, 동기 캐스케이드 아님
    startWrong();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 진입 1회 트리거
  }, [token]);

  async function start() {
    if (!token || !subject) return;
    setBusy(true);
    setErr("");
    setQs(null);
    setCbtQs(null);
    setRetryMode(false);
    // "전체"는 subject 대신 all=1 — 전 과목에서 섞어 출제
    const p = new URLSearchParams(subject === ALL ? { all: "1" } : { subject });
    // CBT는 4지선다(이론)만 다룬다 — 실무 분개는 프로그램으로 푸는 것이라 번호판 채점에 맞지 않는다
    if (cbt) p.set("category", "이론");
    else if (category) p.set("category", category);
    if (areaSel.length) p.set("area", areaSel.join(","));
    if (cbt && source) p.set("source", source);
    if (!cbt && study) p.set("study", "1");
    // 회차를 골랐으면 그 회차 이론 전체를 낸다 (문항 수 선택은 랜덤 출제 전용)
    p.set("limit", String(cbt ? (source ? 50 : count) : 15));
    const r = await fetch(`/api/bank?${p}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(d?.error ?? "문제를 불러오지 못했어요.");

    if (cbt) {
      const theory = (d.questions ?? []).filter((x: Q) => x.type === "theory") as CbtQuestion[];
      if (!theory.length) return setErr("조건에 맞는 4지선다 문제가 없어요.");
      setCbtQs(theory);
      enterRun();
      return;
    }
    setQs(d.questions ?? []);
    setIdx(0);
    setScore({ right: 0, done: 0 });
    resetQ();
    recordedRef.current = false;
    enterRun();
  }

  function resetQ() {
    setPicked(null);
    setGraded(null);
    setRevealed(false);
    setSelfDone(false);
  }

  // 세션 시작/종료를 브라우저 히스토리에 반영 — 뒤로가기가 "페이지 이탈"이 아니라 "필터로 복귀"가 되게
  useEffect(() => {
    const h = () => {
      setQs(null);
      setCbtQs(null);
      setErr("");
    };
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  const enterRun = () => window.history.pushState({ bankRun: true }, "", "?run");
  const exitRun = () => {
    // 세션 진입 때 쌓은 항목을 되감아 주소와 상태를 함께 되돌린다 (안 쌓였으면 상태만)
    if (window.history.state?.bankRun) window.history.back();
    else {
      setQs(null);
      setCbtQs(null);
    }
  };

  const q = qs?.[idx];
  // 공부 모드엔 결과(점수) 화면이 없다
  const finished = !study && qs !== null && qs.length > 0 && idx >= qs.length;

  // "한 문제씩" 완주 시 세션 기록 — CBT는 서버 배치 채점이 직접 기록하므로 여기서만.
  useEffect(() => {
    if (!finished || recordedRef.current || !token || score.done === 0) return;
    recordedRef.current = true;
    fetch("/api/bank/records", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subject: retryMode ? "오답노트" : subject,
        total: score.done,
        score: score.right,
        // 이 회차에서 푼 문항 — 서버가 채점 기록을 세션에 묶어 "뭘 틀렸나" 상세를 만든다.
        // 순서대로 진행하므로 앞 done개가 실제 푼 문항이다.
        questionIds: (qs ?? []).slice(0, score.done).map((x) => x.id),
      }),
    }).catch(() => {});
  }, [finished, token, subject, score, retryMode, qs]);

  // 이론 채점
  async function pick(i: number) {
    // picked까지 봐야 한다 — graded는 응답이 와야 세팅되므로, 그 전에 다시 누르면
    // 같은 문항이 두 번 채점돼 푼 개수·점수가 부풀고 시험 기록이 상세와 어긋난다.
    // (채점 실패 시엔 아래에서 picked를 되돌려 다시 고를 수 있게 한다)
    if (!q || q.type !== "theory" || graded || picked !== null || !token) return;
    setPicked(i);
    const r = await fetch("/api/bank/attempt", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: q.id, chosen: i }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok || !d) {
      setPicked(null);
      return setErr("채점하지 못했어요. 다시 시도해 주세요.");
    }
    setGraded({ correct: d.correct, answer: d.answer_idx, explanation: d.explanation ?? "" });
    setScore((s) => ({ right: s.right + (d.correct ? 1 : 0), done: s.done + 1 }));
  }

  // "몰라요, 못 풀겠어요" — 오답으로 기록하고 정답·해설을 바로 본다 (오답노트에 남음)
  async function giveUp() {
    if (!q || q.type !== "theory" || graded || !token) return;
    const r = await fetch("/api/bank/attempt", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: q.id, giveUp: true }),
    }).catch(() => null);
    const d = await r?.json().catch(() => null);
    if (!r?.ok || !d) return setErr("정답을 불러오지 못했어요. 다시 시도해 주세요.");
    setGraded({ correct: false, answer: d.answer_idx, explanation: d.explanation ?? "" });
    setScore((s) => ({ right: s.right, done: s.done + 1 }));
  }

  // 실무 자가채점
  async function selfMark(correct: boolean) {
    if (!q || q.type !== "practice" || selfDone || !token) return;
    setSelfDone(true);
    setScore((s) => ({ right: s.right + (correct ? 1 : 0), done: s.done + 1 }));
    // 이론 채점과 달리 결과를 안 기다리면 클릭 직후 이탈 시 기록이 유실될 수 있어 await
    await fetch("/api/bank/attempt", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: q.id, correct }),
    }).catch(() => {});
  }

  function next() {
    resetQ();
    setIdx((i) => i + 1);
  }

  // 공부 모드 앞뒤 이동
  function studyGo(delta: number) {
    setIdx((i) => Math.min(Math.max(i + delta, 0), (qs?.length ?? 1) - 1));
  }

  if (gate) return gate;

  // 화면 폭: 필터·CBT는 기존(2xl), 한 문제씩은 살짝 넓게(3xl),
  // 공부 모드는 2단(문제 65:해설 35)이라 PC에서 넓게 써야 줄바꿈 지옥이 없다
  const width = cbtQs ? "max-w-[1240px]" : qs ? (study ? "max-w-[1240px]" : "max-w-3xl") : "max-w-2xl lg:max-w-4xl";

  // 풀이 중(한 문제씩·공부 모드) 상단 바 제목
  const runTitle = retryMode ? "오답 다시 풀기" : study ? `공부 모드${subject ? ` · ${subject}` : ""}` : "한 문제씩";

  return (
    <main className={`flex-1 w-full ${width} mx-auto px-4 lg:px-6 py-6 lg:py-8 flex flex-col gap-3 lg:gap-4`}>
      {/* 필터 화면 — 제목 + 바로가기 6칸 (풀이 중엔 상단 바가 대신한다) */}
      {!qs && !cbtQs && (
        <>
          <div className="rise px-1 pt-2 flex flex-col gap-1">
            <h1 className="text-[24px] lg:text-[28px] font-bold">기출문제</h1>
            <p className="text-sub text-[14px]">전산회계·세무·컴활 기출 {tree ? countFor({}).toLocaleString() : "…"}문항</p>
          </div>
          <nav aria-label="바로가기" className="rise d1 grid grid-cols-6 gap-1.5 sm:gap-2">
            {SHORTCUTS.map(([href, label, tone, icon]) => (
              <Link
                key={href}
                href={href}
                className="card !rounded-[12px] pt-3.5 pb-3 px-1 flex flex-col items-center gap-2 text-[12px] font-bold text-center break-keep transition-colors hover:border-[var(--border-strong)]"
              >
                <span
                  className="w-9 h-9 rounded-[8px] grid place-items-center"
                  style={tone === "red" ? { background: "var(--red-weak)", color: "var(--red)" } : { background: "var(--blue-weak)", color: "var(--blue)" }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {icon}
                  </svg>
                </span>
                {label}
              </Link>
            ))}
          </nav>
        </>
      )}

      {/* 필터 — PC에선 좌(필터) / 우(시험 기록 조회) 2단으로 빈 여백을 없앤다 */}
      {!qs && !cbtQs && (
      <div className="flex flex-col gap-3 lg:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-3">
          {tree === null ? (
            <div className="rise d1 card p-5">
              <div className="skel h-40 !rounded-[12px]" />
            </div>
          ) : (
            <>
              <section className="rise d1 card p-5">
                <h2 className="text-[17px] font-bold mb-3">어떻게 풀까요?</h2>
                <div role="radiogroup" aria-label="풀이 방식" className="flex flex-col gap-2">
                  {(
                    [
                      ["CBT 모의고사", "실제 시험처럼 다 풀고 한 번에 채점해요 (4지선다만)", cbt, () => setCbt(true)],
                      [
                        "한 문제씩",
                        "풀 때마다 바로 정답을 알려줘요",
                        !cbt && !study,
                        () => {
                          setCbt(false);
                          setStudy(false);
                        },
                      ],
                      [
                        "공부 모드",
                        "정답·풀이를 옆에 두고 익혀요",
                        !cbt && study,
                        () => {
                          setCbt(false);
                          setStudy(true);
                        },
                      ],
                    ] as const
                  ).map(([label, desc, on, pickMode]) => (
                    <button
                      key={label}
                      role="radio"
                      aria-checked={on}
                      onClick={pickMode}
                      className="text-left px-4 py-3.5 rounded-[12px] border flex items-center gap-3 transition-colors"
                      style={
                        on
                          ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                          : { borderColor: "var(--border)", background: "var(--fill-2)" }
                      }
                    >
                      <span
                        aria-hidden
                        className="shrink-0 w-[22px] h-[22px] rounded-full"
                        style={on ? { border: "6px solid var(--blue)" } : { border: "2px solid var(--border-strong)" }}
                      />
                      <span className="min-w-0">
                        <span className="block text-[16px] font-bold">{label}</span>
                        <span className="block text-[13px] text-sub mt-0.5 break-keep">{desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rise d2 card p-5 flex flex-col gap-6">
              <Filter label="과목" required>
                {[ALL, ...subjects].map((s) => (
                  <Chip
                    key={s}
                    on={subject === s}
                    onClick={() => {
                      setSubject(subject === s ? "" : s);
                      setAreaSel([]);
                      setSource(""); // 다른 과목의 회차가 선택된 채 남지 않게
                      setCategory(""); // 급수마다 유형이 달라(매입매출전표는 세무만) 이월 방지
                    }}
                  >
                    {s}{" "}
                    <b className="font-semibold" style={{ color: "var(--sub)" }}>
                      {countFor(s === ALL ? {} : { subject: s })}
                    </b>
                  </Chip>
                ))}
              </Filter>
              {cbt && (
                <>
                  {/* 회차는 과목 하나 골랐을 때만 — "전체"는 과목이 섞여 회차 개념이 없다 */}
                  {subject !== ALL && (
                  <Filter label="회차" hint="선택">
                    {/* 과목당 38개 회차 — 칩으로 깔면 화면이 덮여서 드롭다운 하나로 */}
                    <select
                      aria-label="회차"
                      className="field !h-[52px] !py-0 !text-[16px]"
                      style={{ background: "var(--fill-2)" }}
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="">랜덤 출제 (전체 회차)</option>
                      {sources
                        .filter((x) => !subject || x.subject === subject)
                        .sort((a, b) => roundKey(b.source) - roundKey(a.source))
                        .map((x) => (
                          <option key={x.source} value={x.source}>
                            {roundLabel(x.source)} ({x.count}문항)
                          </option>
                        ))}
                    </select>
                  </Filter>
                  )}
                  {/* 회차를 고르면 그 회차 전체가 나가므로 문항 수 선택은 랜덤에서만 */}
                  {!source && (
                  <Filter label="문항 수" grid>
                    {COUNTS.map((n) => (
                      <Chip key={n} on={count === n} onClick={() => setCount(n)} className="h-11 justify-center !text-[15px]">
                        {n}
                      </Chip>
                    ))}
                    {/* 직접 입력 — 칩에 없는 문항 수 (1~50) */}
                    <input
                      type="number"
                      min={1}
                      max={50}
                      placeholder="직접 입력 (1~50)"
                      aria-label="문항 수 직접 입력"
                      className="field col-span-3 !h-11 !py-0 !px-3.5 !text-[15px]"
                      value={(COUNTS as readonly number[]).includes(count) ? "" : count}
                      onChange={(e) => {
                        const n = Math.min(Math.max(Number(e.target.value) || 0, 0), 50);
                        if (n > 0) setCount(n);
                      }}
                    />
                  </Filter>
                  )}
                </>
              )}
              {!cbt && (
              <Filter label="유형" hint="선택">
                {categories.map((c) => {
                  const n = countFor({ subject: subjFilter, category: c });
                  return (
                    <Chip key={c} on={category === c} disabled={n === 0} onClick={() => setCategory(category === c ? "" : c)}>
                      {c} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                    </Chip>
                  );
                })}
              </Filter>
              )}
              {subject && areas.length > 1 && (
                <Filter label="영역" hint="선택 · 여러 개 가능">
                  {/* 다중 선택 — 아무것도 안 고르면 전체 영역 */}
                  {areas.map((a) => {
                    const n = countFor({ subject: subjFilter, category: cbt ? "이론" : category, area: a });
                    return (
                      <Chip
                        key={a}
                        on={areaSel.includes(a)}
                        disabled={n === 0}
                        onClick={() =>
                          setAreaSel((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]))
                        }
                      >
                        {a} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                      </Chip>
                    );
                  })}
                </Filter>
              )}
              </section>
              {/* 비활성일 땐 회색 버튼 — 연파랑+흰 글자는 대비가 2:1이라 안내문이 안 읽힌다 */}
              <button
                onClick={start}
                disabled={!subject || busy}
                className={`btn h-[50px] text-[17px] ${!subject && !busy ? "btn-gray" : "btn-primary disabled:opacity-50"}`}
              >
                {busy
                  ? "불러오는 중…"
                  : !subject
                    ? "과목을 골라 주세요"
                    : cbt
                      ? source
                        ? `${roundLabel(source)} 시험 시작`
                        : `${count}문항 시험 시작`
                      : study
                        ? "공부 시작"
                        : "문제 풀기"}
              </button>
            </>
          )}
        </div>

      {/* 시험 기록 조회 — 이름으로 같은 학원 사용자의 CBT 기록 검색 (학원 공용 PC 확인용) */}
        <details className="rise d3 card p-5 lg:sticky lg:top-[76px]">
          <summary className="font-bold text-[15px] cursor-pointer select-none">
            시험 기록 조회 <span className="text-sub text-[13px] font-normal">· 이름으로 검색</span>
          </summary>
          <div className="flex gap-2 mt-3">
            <input
              className="field !py-2.5 flex-1 min-w-0"
              placeholder="이름 (예: 김학생)"
              value={recName}
              onChange={(e) => setRecName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) searchRecords();
              }}
            />
            <button onClick={searchRecords} disabled={recBusy} className="btn btn-primary px-5 shrink-0 disabled:opacity-50">
              {recBusy ? "검색 중…" : "검색"}
            </button>
          </div>
          {recStats && recStats.totals.attempts > 0 && (
            <div className="mt-3 rounded-[12px] border border-line p-4">
              <p className="text-[13px] font-bold mb-3">{recStats.name} 학생 풀이 통계</p>
              <BankStats stats={recStats} />
            </div>
          )}
          {recs !== null && (
            <div className="flex flex-col gap-1.5 mt-3">
              {recs.length === 0 && <p className="text-sub text-[13px]">기록이 없어요. (같은 학원만 검색돼요)</p>}
              {recs.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-2 text-[13px]">
                  <span className="font-bold shrink-0">{r.name}</span>
                  <span className="truncate flex-1 text-sub">
                    {r.subject === "오답노트" ? "오답노트 다시 풀기" : r.source ? r.source : `${r.subject} 랜덤`}
                  </span>
                  <span className="font-bold tabular-nums shrink-0">
                    {r.score}/{r.total}
                  </span>
                  <span className="text-sub text-[11px] shrink-0">
                    {new Date(r.at).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </details>
      </div>
      )}

      {cbtQs && (
        <CbtRunner
          token={token}
          questions={cbtQs}
          title={source || `${subject} 랜덤 ${cbtQs.length}문항`}
          subject={subject}
          source={source || null}
          onExit={exitRun}
        />
      )}

      {/* 풀이 중 상단 바 — 나가기 · 제목 · 진행 (+ 맞은 개수) */}
      {qs && qs.length > 0 && !finished && (
        <div className="rise flex flex-col gap-1.5">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-h-[44px]">
            <button
              onClick={exitRun}
              className="h-9 px-3 -ml-1 rounded-[8px] text-[15px] font-semibold"
              style={{ color: "var(--sub-2)" }}
            >
              나가기
            </button>
            <div className="min-w-0 text-center">
              <h2 className="text-[16px] font-bold truncate">{runTitle}</h2>
              {!study && (
                <p className="text-[12px] text-sub tabular-nums">
                  맞은 개수 {score.right} / {score.done}
                </p>
              )}
            </div>
            <span className="text-[14px] font-bold text-blue tabular-nums text-right min-w-[56px]">
              {idx + 1} / {qs.length}
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--fill)" }}>
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${((idx + 1) / qs.length) * 100}%`, background: "var(--blue)" }}
            />
          </div>
        </div>
      )}

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {qs?.length === 0 && (
        <div className="rise card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">조건에 맞는 문제가 없어요</p>
          <button onClick={exitRun} className="btn btn-gray py-2.5 px-5 mt-3 text-[14px]">
            다시 고르기
          </button>
        </div>
      )}

      {/* 공부 모드 — 문제 옆에 정답·풀이. PC(lg~) 65:35 2단 + 해설 sticky, 그 아래는 세로 1단 */}
      {study && q && (
        <div
          key={q.id}
          className="animate-pop grid gap-3 lg:gap-6 lg:items-start lg:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]"
        >
          <div className="card p-5 lg:p-7 flex flex-col gap-4 min-w-0">
            <div className="flex gap-1.5 flex-wrap">
              <span className={TAG} style={TAG_ON}>{q.type === "theory" ? "이론" : "실무"}</span>
              <span className={TAG} style={TAG_FILL}>{q.typeTag}</span>
              <span className={TAG} style={TAG_FILL}>{q.area}</span>
            </div>
            <StemView stem={q.stem} images={q.images} />
            {q.type === "theory" && (
              <div className="flex flex-col gap-2">
                {q.choices.map((c, i) => {
                  const tone = choiceTone(q.answerIdx === i ? "right" : null);
                  return (
                    <div key={i} className={CHOICE_BOX} style={tone.box}>
                      <span className={CHOICE_NUM} style={tone.num}>
                        {i + 1}
                      </span>
                      <span className="min-w-0"><ChoiceView text={c} /></span>
                    </div>
                  );
                })}
              </div>
            )}
            <ExcelTry area={q.area} stem={q.stem} choices={q.type === "theory" ? q.choices : null} />
          </div>
          {/* 해설 — PC에선 스크롤해도 따라오게 sticky (헤더 60px + 여백) */}
          <div className="card p-5 lg:p-6 flex flex-col gap-3 self-start min-w-0 lg:sticky lg:top-[76px]">
            {q.type === "theory" ? (
              <>
                <p className="text-[15px] font-bold text-green">정답 {(q.answerIdx ?? 0) + 1}번</p>
                <p className="text-[18px] lg:text-[20px] font-bold leading-snug break-keep">
                  <ChoiceView text={q.choices[q.answerIdx ?? 0]} />
                </p>
                {q.explanation ? (
                  <>
                    <p className="text-[13px] font-bold text-sub mt-1">해설</p>
                    <ExplanationView text={q.explanation} />
                  </>
                ) : (
                  <p className="text-sub text-[13px]">이 문제는 해설이 없어요.</p>
                )}
              </>
            ) : (
              <>
                <p className="text-[14px] font-bold" style={{ color: "var(--sub-2)" }}>정답 (분개)</p>
                {q.answerText ? (
                  <div className="rounded-[10px] p-3.5" style={{ background: "var(--fill-2)" }}>
                    <JournalEntry text={q.answerText} />
                  </div>
                ) : (
                  <p className="text-sub text-[13px]">정답 없음</p>
                )}
                {q.explanation && (
                  <>
                    <p className="text-[13px] font-bold text-sub mt-1">해설</p>
                    <ExplanationView text={q.explanation} />
                  </>
                )}
              </>
            )}
            <div className="grid grid-cols-[1fr_2fr] gap-2 mt-1">
              <button
                onClick={() => studyGo(-1)}
                disabled={idx === 0}
                className="btn btn-gray h-[50px] text-[17px] disabled:opacity-50"
              >
                이전
              </button>
              <button
                onClick={() => studyGo(1)}
                disabled={idx >= qs!.length - 1}
                className="btn btn-primary h-[50px] text-[17px] disabled:opacity-50"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 한 문제씩 — 문제 카드 / (실무) 정답·해설 카드 / 자가채점 카드 / 다음 */}
      {!study && q && !finished && (
        <div key={q.id} className="animate-pop flex flex-col gap-3">
          <div className="card p-5 lg:p-6 flex flex-col gap-4">
            <div className="flex gap-1.5 flex-wrap">
              <span className={TAG} style={TAG_ON}>
                {q.type === "theory" ? "이론" : "실무"}
              </span>
              <span className={TAG} style={TAG_FILL}>{q.typeTag}</span>
              <span className={TAG} style={TAG_FILL}>{q.area}</span>
            </div>

            <StemView stem={q.stem} images={q.images} />

            {/* 이론 4지선다 */}
            {q.type === "theory" && (
              <div className="flex flex-col gap-2">
                {q.choices.map((c, i) => {
                  const isPicked = picked === i;
                  const isAnswer = graded?.answer === i;
                  const tone = choiceTone(
                    graded ? (isAnswer ? "right" : isPicked ? "bad" : null) : isPicked ? "on" : null
                  );
                  return (
                    <button
                      key={i}
                      onClick={() => pick(i)}
                      disabled={!!graded || picked !== null}
                      style={tone.box}
                      className={`${CHOICE_BOX} disabled:cursor-default hover:border-[var(--blue)]`}
                    >
                      <span className={CHOICE_NUM} style={tone.num}>
                        {i + 1}
                      </span>
                      <span className="min-w-0"><ChoiceView text={c} /></span>
                    </button>
                  );
                })}
                {!graded && (
                  <button onClick={giveUp} className="self-center text-sub text-[13px] py-2 hover:text-blue transition-colors">
                    몰라요, 못 풀겠어요 — 정답 보기
                  </button>
                )}
              </div>
            )}

            {/* 컴활 2과목 — 엑셀 연습장 */}
            <ExcelTry area={q.area} stem={q.stem} choices={q.type === "theory" ? q.choices : null} />

            {/* 실무 — 정답 보기 전 */}
            {q.type === "practice" && !revealed && (
              <button onClick={() => setRevealed(true)} className="btn btn-primary h-[50px] text-[16px]">
                정답 보기
              </button>
            )}

            {/* 이론 채점 결과 */}
            {graded && (
              <div className="flex flex-col gap-2">
                <p className="text-[15px] font-bold" style={{ color: graded.correct ? "var(--green)" : "var(--red)" }}>
                  {graded.correct
                    ? "정답이에요"
                    : picked === null
                      ? `정답은 ${graded.answer + 1}번이에요 — 오답노트에 담아뒀어요`
                      : `아쉬워요, 정답은 ${graded.answer + 1}번`}
                </p>
                {graded.explanation && (
                  <div className="rounded-[12px] p-4" style={{ background: "var(--fill-2)" }}>
                    <p className="text-[13px] font-bold mb-1.5">해설</p>
                    <ExplanationView text={graded.explanation} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 실무 자가채점 — 정답·해설 카드 + "내 답과 같았나요?" 카드 */}
          {q.type === "practice" && revealed && (
            <>
              <section className="card p-5">
                <p className="text-[14px] font-bold mb-2.5" style={{ color: "var(--sub-2)" }}>정답 (분개)</p>
                {q.answerText ? (
                  <div className="rounded-[10px] p-3.5" style={{ background: "var(--fill-2)" }}>
                    <JournalEntry text={q.answerText} />
                  </div>
                ) : (
                  <p className="text-sub text-[13px]">정답 없음</p>
                )}
                {q.explanation && (
                  <>
                    <p className="text-[14px] font-bold mt-3.5 mb-1.5" style={{ color: "var(--sub-2)" }}>해설</p>
                    <ExplanationView text={q.explanation} />
                  </>
                )}
              </section>
              <section className="card p-5">
                {!selfDone ? (
                  <>
                    <p className="text-[16px] font-bold mb-3">내 답과 같았나요?</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => selfMark(true)}
                        className="btn h-[52px] text-[16px] !rounded-[10px]"
                        style={{ background: "var(--blue-weak)", color: "var(--blue)" }}
                      >
                        맞혔어요
                      </button>
                      <button
                        onClick={() => selfMark(false)}
                        className="btn h-[52px] text-[16px] !rounded-[10px]"
                        style={{ background: "var(--red-weak)", color: "var(--red)" }}
                      >
                        틀렸어요
                      </button>
                    </div>
                    <p className="mt-2.5 text-center text-[13px] text-sub">고르면 기록돼요 · 틀리면 기출 오답노트로</p>
                  </>
                ) : (
                  <p className="text-sub text-[14px] text-center">기록했어요.</p>
                )}
              </section>
            </>
          )}

          {(graded || selfDone) && (
            <button onClick={next} className="btn btn-primary h-[50px] text-[17px]">
              {idx + 1 >= (qs?.length ?? 0) ? "결과 보기" : "다음 문제"}
            </button>
          )}
        </div>
      )}

      {/* 결과 */}
      {finished && (
        <div className="rise flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 min-h-[44px]">
            <h2 className="text-[16px] font-bold truncate">{runTitle} 결과</h2>
            <button onClick={exitRun} aria-label="닫기" className="w-11 h-11 -mr-2.5 grid place-items-center shrink-0">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <section className="card p-5 lg:p-6">
            <p className="text-[14px] text-sub">{qs!.length}문제 중</p>
            <p className="text-[32px] font-bold tabular-nums mt-1 mb-3">
              {score.right} <span className="text-[20px] text-sub">/ {score.done}</span>{" "}
              {score.done > 0 && (
                <span className="text-[18px] text-blue">정답률 {Math.round((score.right / score.done) * 100)}%</span>
              )}
            </p>
            {score.done > 0 && (
              <>
                <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5" style={{ background: "var(--fill)" }}>
                  <div style={{ flex: score.right, background: "var(--blue)" }} />
                  <div style={{ flex: score.done - score.right, background: "var(--red-weak)" }} />
                </div>
                <p className="mt-3 px-3.5 py-3 rounded-[8px] text-[14px]" style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}>
                  내 시험 기록에 저장됐어요.
                </p>
              </>
            )}
          </section>
          <div className="grid grid-cols-2 gap-2">
            <Link
              href="/my/records"
              className="btn grid place-items-center h-[50px] text-[16px] border border-line"
              style={{ background: "var(--surface)" }}
            >
              내 기록 보기
            </Link>
            <button onClick={exitRun} className="btn btn-primary h-[50px] text-[16px]">
              다른 문제 풀기
            </button>
            <Link href="/bank/notes" className="btn btn-gray col-span-2 grid place-items-center h-[50px] text-[16px]">
              오답노트 보기
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

// 바로가기 6칸 — [주소, 이름, 색, 아이콘]. 실무 연습은 분개를 KcLep처럼 직접 입력·자동 채점하는 화면. 실무 검색은 같은 검색 화면을 실무 탭(?kind=practice)으로 연다
// (분개 문제는 이론 탭에서 안 나와 따로 진입이 없으면 못 찾는다)
const SHORTCUTS: [string, string, "blue" | "red", React.ReactNode][] = [
  ["/my/records", "내 기록", "blue", <path key="i" d="M4 19V9M10 19V5M16 19v-7M22 19H2" />],
  ["/bank/notes", "기출 오답", "red", <path key="i" d="M7 7l10 10M17 7L7 17" />],
  [
    "/bank/browse",
    "문제검색",
    "blue",
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>,
  ],
  [
    "/bank/browse?kind=practice",
    "실무 검색",
    "blue",
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M12 3v18M4 9h16" />
    </>,
  ],
  [
    "/bank/practice",
    "실무 연습",
    "blue",
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h4M7 13h10M7 17h6M15 9h2" />
    </>,
  ],
  [
    "/bank/excel",
    "엑셀 연습장",
    "blue",
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 4v16" />
    </>,
  ],
];

function Filter({
  label,
  required,
  hint,
  grid,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  grid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[17px] font-bold">
        {label}
        {required && <span className="text-blue"> *</span>}
        {hint && <span className="text-sub text-[13px] font-normal"> · {hint}</span>}
      </h2>
      <div className={grid ? "grid grid-cols-3 gap-2" : "flex gap-2 flex-wrap"}>{children}</div>
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  className = "",
  children,
}: {
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`chip min-h-10 inline-flex items-center gap-1 ${on ? "chip-on" : ""} disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
    >
      {children}
    </button>
  );
}
