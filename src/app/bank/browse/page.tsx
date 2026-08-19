"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import JournalEntry from "@/components/JournalEntry";
import { StemView, ExplanationView } from "@/components/BankQuestion";

type Q = {
  id: string;
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
type TreeRow = { subject: string; count: number };

// 문제검색 — 급수를 고르고 키워드를 검색하면 지문에 그 말이 포함된 문제를 전부 보여준다.
// 정답은 바로 보여주지 않고 "답안 보기"를 눌러야 체크된다 (스스로 생각해 볼 여지).
export default function BankBrowsePage() {
  const { session, gate } = useGate("any", { loginMessage: "문제검색은 로그인 후 쓸 수 있어요." });
  const token = session?.access_token;

  const [tree, setTree] = useState<TreeRow[] | null>(null);
  const [subject, setSubject] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ questions: Q[]; total: number; q: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // 답안은 바로 보여주지 않는다 — "답안 보기"를 누른 문제만 체크
  const [answered, setAnswered] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch("/api/bank", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setTree(d.tree ?? []))
      .catch(() => setTree([]));
  }, [token]);

  const subjects = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of (tree ?? []) as { subject: string; count: number }[])
      c.set(t.subject, (c.get(t.subject) ?? 0) + t.count);
    return [...c.entries()].sort();
  }, [tree]);

  async function search() {
    const kw = q.trim();
    if (!subject) return setErr("급수(과목)를 먼저 골라 주세요.");
    if (kw.length < 2) return setErr("검색어는 두 글자 이상 입력해 주세요.");
    if (busy || !token) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/bank/search?subject=${encodeURIComponent(subject)}&q=${encodeURIComponent(kw)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) return setErr(d?.error ?? "검색하지 못했어요.");
      setResult({ questions: d.questions ?? [], total: d.total ?? 0, q: kw });
      setOpen(null);
      setAnswered(null);
    } finally {
      setBusy(false);
    }
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-3xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <BackButton fallback="/bank" />
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">문제검색</h1>
          <p className="text-sub text-[14px]">급수를 고르고 키워드를 검색하면 그 말이 들어간 기출문제를 전부 모아 보여줘요.</p>
        </div>
        <Link href="/bank" className="chip shrink-0 !text-[13px]">
          기출문제
        </Link>
      </div>

      <div className="rise d1 card p-5 flex flex-col gap-3">
        {tree === null ? (
          <div className="skel h-20 !rounded-[16px]" />
        ) : (
          <>
            <div className="flex gap-1.5 flex-wrap">
              {subjects.map(([s, n]) => (
                <button
                  key={s}
                  onClick={() => setSubject(subject === s ? "" : s)}
                  className={`chip !text-[13px] ${subject === s ? "chip-on" : ""}`}
                >
                  {s} <b className="opacity-60">{n}</b>
                </button>
              ))}
            </div>
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
              <button onClick={search} disabled={busy} className="btn btn-primary px-6 shrink-0 disabled:opacity-50">
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
          <div className="flex flex-col gap-2">
            {result.questions.map((n) => {
              const isOpen = open === n.id;
              const isTheory = Array.isArray(n.choices) && n.choices.length > 0;
              return (
                <div key={n.id} className="rise card overflow-hidden">
                  <button
                    onClick={() => setOpen(isOpen ? null : n.id)}
                    className="w-full text-left p-4 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex gap-1.5 flex-wrap mb-1">
                        {n.source && <span className="chip !py-0.5 !px-2 !text-[11px]">{n.source}</span>}
                        <span className="chip !py-0.5 !px-2 !text-[11px]">{n.typeTag}</span>
                        <span className="chip !py-0.5 !px-2 !text-[11px]">{isTheory ? "이론" : "실무"}</span>
                      </div>
                      <p className="text-[14px] font-medium line-clamp-2 break-keep">{n.stem.split("\n")[0]}</p>
                    </div>
                    <span className="text-sub text-[13px] shrink-0">{isOpen ? "접기" : "보기"}</span>
                  </button>

                  {isOpen && (() => {
                    const show = answered === n.id;
                    return (
                    <div className="px-4 lg:px-5 pb-5 flex flex-col gap-4 border-t border-line pt-4">
                      <StemView stem={n.stem} images={n.images} />
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
                              <span className="flex-1 min-w-0">{c}</span>
                              {show && n.answerIdx === i && <span className="text-blue text-[11px] font-bold shrink-0">정답</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {!show ? (
                        <button onClick={() => setAnswered(n.id)} className="btn btn-primary py-3">
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
                  })()}
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
