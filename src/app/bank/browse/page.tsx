"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import JournalEntry from "@/components/JournalEntry";
import { StemView, ExplanationView, Hi } from "@/components/BankQuestion";

type Q = {
  id: string;
  subject: string;
  category: string;
  typeTag: string;
  area: string;
  source: string | null;
  stem: string;
  choices: string[] | null;
  answerIdx: number | null;
  answerText: string | null;
  explanation: string | null;
  images?: string[] | null;
};
type TreeRow = { subject: string; area: string; category: string; count: number };

const PER = 10; // 페이지당 문제 수

// 이론 영역 뱃지 — [DB area 값, 화면 이름]. 법인세는 아직 0문항(전산세무1급 자료 없음)이라 비활성으로 보이고,
// 적재되면 트리 집계에 잡혀 자동으로 켜진다.
const AREAS: [string, string][] = [
  ["재무회계", "재무"],
  ["원가회계", "원가"],
  ["부가가치세", "부가가치세"],
  ["소득세", "소득세"],
  ["법인세", "법인세"],
];
const areaLabel = (a: string) => AREAS.find(([v]) => v === a)?.[1] ?? a;

// 실무 유형 뱃지 — DB category 값 그대로. 매입매출전표는 전산세무2급만 있다(회계 급수는 일반전표·결산 2분류)
const PRACTICE_TYPES = ["일반전표", "매입매출전표", "결산"];

// 문제검색 — 급수를 고르고 키워드를 검색하면 지문에 그 말이 포함된 문제를 전부 보여준다.
// 이론(4지선다)/실무(일반전표·매입매출전표·결산) 탭으로 나뉜다 — 실무는 정답이 분개 표라 보는 방식이 다르다.
// 정답은 바로 보여주지 않고 "답안 보기"를 눌러야 체크된다 (스스로 생각해 볼 여지).
export default function BankBrowsePage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <BrowseInner />
    </Suspense>
  );
}

function BrowseInner() {
  // /bank/browse?kind=practice 로 실무 탭 바로 진입 (기본 이론)
  const params = useSearchParams();
  const { session, gate } = useGate("any", { loginMessage: "문제검색은 로그인 후 쓸 수 있어요." });
  const token = session?.access_token;

  const [tree, setTree] = useState<TreeRow[] | null>(null);
  const [subject, setSubject] = useState("");
  const [area, setArea] = useState(""); // 이론 영역 뱃지 ("" = 전체 영역)
  const [ptype, setPtype] = useState(""); // 실무 유형 뱃지 ("" = 전체 유형)
  // 이론(4지선다) / 실무(일반전표·매입매출전표·결산) 탭
  const [kind, setKind] = useState<"theory" | "practice">(
    params.get("kind") === "practice" ? "practice" : "theory"
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{
    questions: Q[];
    total: number;
    q: string;
    subject: string;
    area: string;
    ptype: string;
  } | null>(null);
  // 답안은 바로 보여주지 않는다 — "답안 보기"를 누른 문제만 체크 (문제별 독립)
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0); // 10문제씩 페이징


  useEffect(() => {
    if (!token) return;
    fetch("/api/bank", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setTree(d.tree ?? []))
      .catch(() => setTree([]));
  }, [token]);

  // 급수별 문항 수 — 현재 탭(이론/실무) 기준으로 집계
  const subjects = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tree ?? []) {
      const isTheoryRow = t.category === "이론";
      if (kind === "theory" ? !isTheoryRow : isTheoryRow) continue;
      c.set(t.subject, (c.get(t.subject) ?? 0) + t.count);
    }
    return [...c.entries()].sort();
  }, [tree, kind]);

  // 이론 영역별 문항 수 — subj가 ""면 전 급수. 급수를 바꾸기 직전 새 급수 기준으로도 세야 해서 함수로 둔다
  function areaCount(subj: string, a: string): number {
    return (tree ?? [])
      .filter((t) => t.category === "이론" && t.area === a && (!subj || t.subject === subj))
      .reduce((sum, t) => sum + t.count, 0);
  }

  // 실무 유형별 문항 수 — category가 곧 유형이라 그대로 센다
  function typeCount(subj: string, c: string): number {
    return (tree ?? [])
      .filter((t) => t.category === c && (!subj || t.subject === subj))
      .reduce((sum, t) => sum + t.count, 0);
  }

  // over: 칩을 누른 직후엔 setState가 아직 반영 전이라 새 값을 직접 넘긴다
  async function search(over: { kind?: "theory" | "practice"; subject?: string; area?: string; ptype?: string } = {}) {
    const useKind = over.kind ?? kind;
    const useSubject = over.subject ?? subject;
    const useArea = useKind === "theory" ? over.area ?? area : ""; // 영역 뱃지는 이론 탭 전용
    const useType = useKind === "practice" ? over.ptype ?? ptype : ""; // 유형 뱃지는 실무 탭 전용
    const kw = q.trim();
    // 실무는 급수 필수. 이론은 급수를 고르면 그 급수만, "전체"면 전 급수 통합 검색.
    if (useKind === "practice" && !useSubject) return setErr("급수(과목)를 먼저 골라 주세요.");
    if (kw.length < 2) return setErr("검색어는 두 글자 이상 입력해 주세요.");
    if (busy || !token) return;
    setBusy(true);
    setErr("");
    try {
      const subjQ = useSubject ? `subject=${encodeURIComponent(useSubject)}&` : "";
      const areaQ = useArea ? `area=${encodeURIComponent(useArea)}&` : "";
      const typeQ = useType ? `category=${encodeURIComponent(useType)}&` : "";
      const r = await fetch(`/api/bank/search?${subjQ}${areaQ}${typeQ}q=${encodeURIComponent(kw)}&kind=${useKind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "검색하지 못했어요.");
      setResult({ questions: d.questions ?? [], total: d.total ?? 0, q: kw, subject: useSubject, area: useArea, ptype: useType });
      setAnswered(new Set());
      setPage(0);
    } finally {
      setBusy(false);
    }
  }

  function goPage(p: number) {
    setPage(p);
    window.scrollTo({ top: 0 }); // 페이지 넘기면 첫 문제부터 보이게
  }

  // 급수 칩 — 같은 칩을 다시 누르면 해제(이론은 "전체"로 돌아감). 결과가 떠 있으면 바로 재검색
  function pickSubject(s: string) {
    const next = subject === s ? "" : s;
    if (next === subject) return;
    // 새 급수에 고른 영역·유형 문항이 없으면 전체로 (예: 전산회계2급은 재무뿐, 매입매출전표는 전산세무2급만)
    const nextArea = area && areaCount(next, area) === 0 ? "" : area;
    const nextType = ptype && typeCount(next, ptype) === 0 ? "" : ptype;
    setSubject(next);
    setArea(nextArea);
    setPtype(nextType);
    if (result && q.trim().length >= 2 && !(kind === "practice" && !next))
      search({ subject: next, area: nextArea, ptype: nextType });
  }

  // 영역 뱃지 (이론) — 같은 뱃지를 다시 누르면 전체 영역. 결과가 떠 있으면 바로 재검색
  function pickArea(a: string) {
    const next = area === a ? "" : a;
    if (next === area) return;
    setArea(next);
    if (result && q.trim().length >= 2) search({ area: next });
  }

  // 유형 뱃지 (실무) — 같은 뱃지를 다시 누르면 전체 유형. 급수가 골라져 있고 결과가 떠 있으면 바로 재검색
  function pickType(c: string) {
    const next = ptype === c ? "" : c;
    if (next === ptype) return;
    setPtype(next);
    if (result && q.trim().length >= 2 && subject) search({ ptype: next });
  }

  // 이론/실무 탭 전환 — 결과가 떠 있으면 같은 검색어로 새 탭에서 재검색
  function switchKind(k: "theory" | "practice") {
    if (k === kind) return;
    setKind(k);
    window.history.replaceState({}, "", `/bank/browse${k === "practice" ? "?kind=practice" : ""}`);
    setErr("");
    // 급수 선택은 두 탭이 공유 — 새 탭에 그 급수 문항이 없으면 풀어 준다 (칩이 안 보이는데 선택만 남지 않게)
    const has = (tree ?? []).some((t) => t.subject === subject && (t.category === "이론") === (k === "theory"));
    const nextSubject = has ? subject : "";
    if (nextSubject !== subject) setSubject(nextSubject);
    // 실무로 넘어가는데 급수 미선택이면 이전 탭 결과만 비운다 (급수 고르고 재검색)
    if (result && q.trim().length >= 2 && !(k === "practice" && !nextSubject)) search({ kind: k, subject: nextSubject });
    else setResult(null);
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-3xl lg:max-w-4xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">
            문제검색 {kind === "practice" ? "(실무)" : "(이론)"}
          </h1>
          <p className="text-sub text-[14px]">
            {kind === "practice"
              ? "급수를 고르고 키워드를 검색하면 그 말이 들어간 실무 기출문제를 모아 보여줘요. 일반전표·매입매출전표·결산으로 나눠 볼 수도 있어요."
              : "급수·영역을 고르거나 전체로 두고 키워드를 검색하면 이론(4지선다) 기출문제를 모아 보여줘요. 문제마다 급수가 표시돼요."}
          </p>
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      {/* 이론/실무 탭 */}
      <div className="rise d1 flex flex-wrap gap-1.5">
        <button onClick={() => switchKind("theory")} className={`chip !text-[13px] ${kind === "theory" ? "chip-on" : ""}`}>
          문제검색(이론)
        </button>
        <button
          onClick={() => switchKind("practice")}
          className={`chip !text-[13px] ${kind === "practice" ? "chip-on" : ""}`}
        >
          문제검색(실무)
        </button>
        <span className="self-center text-[12px] text-sub ml-1">
          {kind === "practice" ? "일반전표·매입매출·결산 문제 — 정답이 분개 표로 나와요" : "4지선다 문제"}
        </span>
      </div>

      <div className="rise d1 card p-5 flex flex-col gap-3">
        {tree === null ? (
          <div className="skel h-20 !rounded-[16px]" />
        ) : (
          <>
            {/* 급수 선택 — 이론은 "전체"(전 급수 통합, 결과에 급수 태그)가 기본이고 급수로 좁힐 수 있다. 실무는 급수 필수 */}
            <div className="flex gap-1.5 flex-wrap">
              {kind === "theory" && (
                <button
                  onClick={() => pickSubject("")}
                  className={`chip !text-[13px] ${subject === "" ? "chip-on" : ""}`}
                >
                  전체 급수 <b className="font-semibold" style={{ color: "var(--sub)" }}>{subjects.reduce((sum, [, n]) => sum + n, 0)}</b>
                </button>
              )}
              {subjects.map(([s, n]) => (
                <button
                  key={s}
                  onClick={() => pickSubject(s)}
                  className={`chip !text-[13px] ${subject === s ? "chip-on" : ""}`}
                >
                  {s} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                </button>
              ))}
            </div>
            {/* 영역 뱃지 (이론 전용) — 수는 고른 급수 기준. 그 급수에 없는 영역은 비활성 (예: 전산회계2급은 재무뿐) */}
            {kind === "theory" && (
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => pickArea("")} className={`chip !text-[13px] ${area === "" ? "chip-on" : ""}`}>
                  전체 영역
                </button>
                {AREAS.map(([a, label]) => {
                  const n = areaCount(subject, a);
                  return (
                    <button
                      key={a}
                      onClick={() => pickArea(a)}
                      disabled={n === 0}
                      className={`chip !text-[13px] ${area === a ? "chip-on" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {label} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                    </button>
                  );
                })}
              </div>
            )}
            {/* 유형 뱃지 (실무 전용) — 수는 고른 급수 기준. 그 급수에 없는 유형은 비활성 (매입매출전표는 전산세무2급만) */}
            {kind === "practice" && (
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={() => pickType("")} className={`chip !text-[13px] ${ptype === "" ? "chip-on" : ""}`}>
                  전체 유형
                </button>
                {PRACTICE_TYPES.map((c) => {
                  const n = typeCount(subject, c);
                  return (
                    <button
                      key={c}
                      onClick={() => pickType(c)}
                      disabled={n === 0}
                      className={`chip !text-[13px] ${ptype === c ? "chip-on" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {c} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="field flex-1"
                placeholder='키워드 (예: "재무", "감가상각")'
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) search();
                }}
              />
              <button onClick={() => search()} disabled={busy} className="btn btn-primary px-6 shrink-0 disabled:opacity-50">
                {busy ? "검색 중…" : "검색"}
              </button>
            </div>
            {err && (
              <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
                {err}
              </p>
            )}
          </>
        )}
      </div>

      {result && (
        <>
          <p className="rise text-sub text-[13px]">
            {[result.subject, result.area && areaLabel(result.area), result.ptype].filter(Boolean).map((s) => `${s} · `).join("")}
            &ldquo;{result.q}&rdquo; 포함 문제 <b className="text-blue">{result.total}</b>건
            {result.total > result.questions.length ? ` (최근 회차부터 ${result.questions.length}건 표시)` : ""}
          </p>
          {result.questions.length === 0 && (
            <div className="rise card p-10 text-center">
              <p className="text-[15px] font-bold">검색 결과가 없어요</p>
              <p className="text-sub text-[13px] mt-1">다른 키워드로 다시 찾아보세요.</p>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {result.questions.slice(page * PER, page * PER + PER).map((n, pi) => {
              const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
              const show = answered.has(n.id);
              return (
                <div key={n.id} className="rise card p-4 lg:p-5 flex flex-col gap-4">
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{page * PER + pi + 1}번</span>
                    {/* 급수 태그 — 통합 검색이라 문제마다 어느 급수인지 보여준다 */}
                    {n.subject && (
                      <span className="chip chip-on !py-0.5 !px-2 !text-[11px] !cursor-default">{n.subject}</span>
                    )}
                    {n.source && (
                      <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">
                        {/* source가 "전산회계1급 125회" 꼴이라 급수 태그와 겹치는 앞부분은 떼고 회차만 */}
                        {n.subject ? n.source.replace(n.subject, "").trim() || n.source : n.source}
                      </span>
                    )}
                    <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{n.typeTag}</span>
                    {/* 실무는 유형(일반전표·매입매출전표·결산)을 그대로 — 전체 유형으로 찾았을 때 어느 쪽인지 보이게 */}
                    <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{isTheory ? "이론" : n.category || "실무"}</span>
                  </div>
                  <StemView stem={n.stem} images={n.images} highlight={result.q} />
                  {isTheory && (
                    <div className="flex flex-col gap-2.5">
                      {n.choices!.map((c, i) => (
                        <div
                          key={i}
                          style={show && n.answerIdx === i ? { borderColor: "var(--blue)", background: "var(--blue-weak)" } : {}}
                          className="rounded-[14px] border border-line px-4 py-3.5 min-h-[54px] text-[15px] leading-[1.65] break-keep flex items-start gap-3"
                        >
                          <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                            {i + 1}
                          </span>
                          <span className="flex-1 min-w-0"><Hi text={c} kw={result.q} /></span>
                          {show && n.answerIdx === i && <span className="text-blue text-[11px] font-bold shrink-0">정답</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {!show ? (
                    <button
                      onClick={() => setAnswered((prev) => new Set(prev).add(n.id))}
                      className="btn btn-primary py-3 lg:self-start lg:px-8"
                    >
                      답안 보기
                    </button>
                  ) : (
                    <>
                      {!isTheory && n.answerText && (
                        <div className="rounded-[14px] border border-line p-4" style={{ background: "var(--blue-weak)" }}>
                          <p className="text-[12px] font-bold text-blue mb-1.5">정답 (분개)</p>
                          <JournalEntry text={n.answerText} />
                        </div>
                      )}
                      {n.explanation && (
                        <div className="rounded-[14px] border border-line p-4">
                          <p className="text-[12px] font-bold text-sub mb-1.5">해설</p>
                          <ExplanationView text={n.explanation} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* 페이징 — 10문제씩 */}
          {result.questions.length > PER && (
            <div className="rise flex items-center justify-center gap-1.5 flex-wrap py-2">
              <button
                onClick={() => goPage(page - 1)}
                disabled={page === 0}
                className="chip !text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← 이전
              </button>
              {Array.from({ length: Math.ceil(result.questions.length / PER) }, (_, i) => (
                <button
                  key={i}
                  onClick={() => goPage(i)}
                  className={`chip !text-[13px] tabular-nums ${i === page ? "chip-on" : ""}`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => goPage(page + 1)}
                disabled={page >= Math.ceil(result.questions.length / PER) - 1}
                className="chip !text-[13px] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                다음 →
              </button>
            </div>
          )}
        </>
      )}
    </main>
  );
}
