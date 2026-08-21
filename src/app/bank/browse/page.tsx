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
type TreeRow = { subject: string; category: string; count: number };

const PER = 10; // 페이지당 문제 수

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
  // 이론(4지선다) / 실무(일반전표·매입매출전표·결산) 탭
  const [kind, setKind] = useState<"theory" | "practice">(
    params.get("kind") === "practice" ? "practice" : "theory"
  );
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ questions: Q[]; total: number; q: string } | null>(null);
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

  async function search(useKind: "theory" | "practice" = kind) {
    const kw = q.trim();
    // 이론은 전 급수 통합 검색 — 급수 선택 없음. 실무만 급수를 고른다.
    if (useKind === "practice" && !subject) return setErr("급수(과목)를 먼저 골라 주세요.");
    if (kw.length < 2) return setErr("검색어는 두 글자 이상 입력해 주세요.");
    if (busy || !token) return;
    setBusy(true);
    setErr("");
    try {
      const subjQ = useKind === "practice" ? `subject=${encodeURIComponent(subject)}&` : "";
      const r = await fetch(`/api/bank/search?${subjQ}q=${encodeURIComponent(kw)}&kind=${useKind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "검색하지 못했어요.");
      setResult({ questions: d.questions ?? [], total: d.total ?? 0, q: kw });
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

  // 이론/실무 탭 전환 — 결과가 떠 있으면 같은 검색어로 새 탭에서 재검색
  function switchKind(k: "theory" | "practice") {
    if (k === kind) return;
    setKind(k);
    window.history.replaceState({}, "", `/bank/browse${k === "practice" ? "?kind=practice" : ""}`);
    setErr("");
    // 실무로 넘어가는데 급수 미선택이면 이전 탭 결과만 비운다 (급수 고르고 재검색)
    if (result && q.trim().length >= 2 && !(k === "practice" && !subject)) search(k);
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
              ? "급수를 고르고 키워드를 검색하면 그 말이 들어간 실무(일반전표·매입매출·결산) 기출문제를 전부 모아 보여줘요."
              : "키워드를 검색하면 전 급수의 이론(4지선다) 기출문제를 한 번에 모아 보여줘요. 문제마다 급수가 표시돼요."}
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
            {/* 이론은 전 급수 통합 — 급수 선택은 실무에만 (결과엔 급수 태그가 붙는다) */}
            {kind === "practice" && (
              <div className="flex gap-1.5 flex-wrap">
                {subjects.map(([s, n]) => (
                  <button
                    key={s}
                    onClick={() => setSubject(subject === s ? "" : s)}
                    className={`chip !text-[13px] ${subject === s ? "chip-on" : ""}`}
                  >
                    {s} <b className="font-semibold" style={{ color: "var(--sub)" }}>{n}</b>
                  </button>
                ))}
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
                    <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{isTheory ? "이론" : "실무"}</span>
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
