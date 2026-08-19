"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import JournalEntry from "@/components/JournalEntry";
import CbtRunner, { type CbtQuestion } from "@/components/CbtRunner";

// answerIdx·explanation은 공부 모드에서만 함께 온다
type Theory = { id: string; type: "theory"; stem: string; choices: string[]; area: string; typeTag: string; answerIdx?: number; explanation?: string | null };
type Practice = {
  id: string;
  type: "practice";
  stem: string;
  answerText: string | null;
  explanation: string | null;
  area: string;
  typeTag: string;
};
type Q = Theory | Practice;
type TreeRow = { subject: string; area: string; category: string; type_tag: string; count: number };
type SourceRow = { subject: string; source: string; count: number };

// 한 세션에 풀 문항 수 — 빠른 선택
const COUNTS = [5, 10, 15, 20, 30] as const;
// 회차 문자열에서 숫자만 뽑아 정렬용으로 (예: "전산회계1급 125회" → 125)
const roundNo = (s: string) => Number((s.match(/(\d+)\s*회/) ?? [])[1] ?? 0);

const CATEGORIES = ["이론", "실무분개", "결산"] as const;

// stem에서 첨부 서식([[서식]]) 분리 — 행 정렬이 생명이라 가로 스크롤 박스로
function splitStem(stem: string): { body: string; form: string | null } {
  const parts = stem.split("\n[[서식]]\n");
  return parts.length > 1 ? { body: parts[0], form: parts.slice(1).join("\n") } : { body: stem, form: null };
}

export default function BankPage() {
  const { session, gate } = useGate("any", { loginMessage: "기출문제 풀이 기록은 계정에 저장돼요." });

  const [tree, setTree] = useState<TreeRow[] | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");

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
  const [allRounds, setAllRounds] = useState(false); // 회차 칩 전체 펼침

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
  const areas = useMemo(() => {
    const set = new Set(
      (tree ?? [])
        .filter((t) => (!subject || t.subject === subject) && (!category || t.category === category))
        .map((t) => t.area)
    );
    return [...set];
  }, [tree, subject, category]);

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

  async function start() {
    if (!token || !subject) return;
    setBusy(true);
    setErr("");
    setQs(null);
    setCbtQs(null);
    const p = new URLSearchParams({ subject });
    // CBT는 4지선다(이론)만 다룬다 — 실무 분개는 프로그램으로 푸는 것이라 번호판 채점에 맞지 않는다
    if (cbt) p.set("category", "이론");
    else if (category) p.set("category", category);
    if (area) p.set("area", area);
    if (cbt && source) p.set("source", source);
    if (!cbt && study) p.set("study", "1");
    p.set("limit", String(cbt ? count : 15));
    const r = await fetch(`/api/bank?${p}`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    const d = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErr(d?.error ?? "문제를 불러오지 못했어요.");

    if (cbt) {
      const theory = (d.questions ?? []).filter((x: Q) => x.type === "theory") as CbtQuestion[];
      if (!theory.length) return setErr("조건에 맞는 4지선다 문제가 없어요.");
      setCbtQs(theory);
      return;
    }
    setQs(d.questions ?? []);
    setIdx(0);
    setScore({ right: 0, done: 0 });
    resetQ();
  }

  function resetQ() {
    setPicked(null);
    setGraded(null);
    setRevealed(false);
    setSelfDone(false);
  }

  const q = qs?.[idx];
  // 공부 모드엔 결과(점수) 화면이 없다
  const finished = !study && qs !== null && qs.length > 0 && idx >= qs.length;

  // 이론 채점
  async function pick(i: number) {
    if (!q || q.type !== "theory" || graded || !token) return;
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

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] lg:text-[28px] font-extrabold">기출문제</h1>
          <p className="text-sub text-[14px]">전산회계·세무 기출 {tree ? countFor({}).toLocaleString() : "…"}문항</p>
        </div>
        <Link href="/bank/notes" className="chip shrink-0 !text-[13px]">
          오답노트
        </Link>
      </div>

      {/* 필터 */}
      {!qs && !cbtQs && (
        <div className="rise d1 card p-5 flex flex-col gap-4">
          {tree === null ? (
            <div className="skel h-40 !rounded-[16px]" />
          ) : (
            <>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setCbt(true)}
                  className={`chip !text-[13px] ${cbt ? "chip-on" : ""}`}
                >
                  CBT 모의고사
                </button>
                <button
                  onClick={() => {
                    setCbt(false);
                    setStudy(false);
                  }}
                  className={`chip !text-[13px] ${!cbt && !study ? "chip-on" : ""}`}
                >
                  한 문제씩
                </button>
                <button
                  onClick={() => {
                    setCbt(false);
                    setStudy(true);
                  }}
                  className={`chip !text-[13px] ${!cbt && study ? "chip-on" : ""}`}
                >
                  공부 모드
                </button>
              </div>
              <p className="text-[12px] text-sub -mt-2">
                {cbt
                  ? "실제 시험처럼 번호판으로 오가며 풀고 마지막에 한 번에 채점해요. (4지선다만)"
                  : study
                    ? "정답·풀이를 옆에 두고 익혀요."
                    : "한 문제 풀 때마다 바로 채점해요."}
              </p>
              <Filter label="과목" required>
                {subjects.map((s) => (
                  <Chip
                    key={s}
                    on={subject === s}
                    onClick={() => {
                      setSubject(subject === s ? "" : s);
                      setArea("");
                    }}
                  >
                    {s} <b className="opacity-60">{countFor({ subject: s })}</b>
                  </Chip>
                ))}
              </Filter>
              {cbt && (
                <>
                  <Filter label="회차 (선택)">
                    <Chip on={source === ""} onClick={() => setSource("")}>
                      랜덤 출제
                    </Chip>
                    {(() => {
                      const mine = sources
                        .filter((x) => !subject || x.subject === subject)
                        .sort((a, b) => roundNo(b.source) - roundNo(a.source));
                      // 기본은 최근 회차만 — 과목당 38개를 다 깔면 화면이 칩으로 덮인다
                      const shown = allRounds ? mine : mine.slice(0, 24);
                      return (
                        <>
                          {shown.map((x) => (
                            <Chip
                              key={x.source}
                              on={source === x.source}
                              onClick={() => setSource(source === x.source ? "" : x.source)}
                            >
                              {roundNo(x.source) ? `${roundNo(x.source)}회` : x.source}{" "}
                              <b className="opacity-60">{x.count}</b>
                            </Chip>
                          ))}
                          {mine.length > shown.length && (
                            <Chip onClick={() => setAllRounds(true)}>+{mine.length - shown.length}개 더보기</Chip>
                          )}
                          {allRounds && mine.length > 24 && (
                            <Chip onClick={() => setAllRounds(false)}>접기</Chip>
                          )}
                        </>
                      );
                    })()}
                  </Filter>
                  <Filter label="문항 수">
                    {COUNTS.map((n) => (
                      <Chip key={n} on={count === n} onClick={() => setCount(n)}>
                        {n}문항
                      </Chip>
                    ))}
                  </Filter>
                </>
              )}
              {!cbt && (
              <Filter label="유형 (선택)">
                {CATEGORIES.map((c) => {
                  const n = countFor({ subject, category: c });
                  return (
                    <Chip key={c} on={category === c} disabled={n === 0} onClick={() => setCategory(category === c ? "" : c)}>
                      {c} <b className="opacity-60">{n}</b>
                    </Chip>
                  );
                })}
              </Filter>
              )}
              {subject && areas.length > 1 && (
                <Filter label="영역 (선택)">
                  {areas.map((a) => (
                    <Chip key={a} on={area === a} onClick={() => setArea(area === a ? "" : a)}>
                      {a} <b className="opacity-60">{countFor({ subject, category, area: a })}</b>
                    </Chip>
                  ))}
                </Filter>
              )}
              <button
                onClick={start}
                disabled={!subject || busy}
                className="btn btn-primary py-3.5 disabled:opacity-50"
              >
                {busy
                  ? "불러오는 중…"
                  : !subject
                    ? "과목을 골라 주세요"
                    : cbt
                      ? source
                        ? `${roundNo(source) || ""}회 시험 시작`
                        : `${count}문항 시험 시작`
                      : study
                        ? "공부 시작"
                        : "문제 풀기"}
              </button>
            </>
          )}
        </div>
      )}

      {cbtQs && (
        <CbtRunner
          token={token}
          questions={cbtQs}
          title={source || `${subject} 랜덤 ${cbtQs.length}문항`}
          onExit={() => setCbtQs(null)}
        />
      )}

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {/* 진행 */}
      {qs && qs.length > 0 && !finished && (
        <div className="rise flex items-center justify-between text-[13px] text-sub">
          <span>
            {idx + 1} / {qs.length}문제
          </span>
          {!study && (
            <span className="tabular-nums">
              맞은 개수 {score.right} / {score.done}
            </span>
          )}
        </div>
      )}

      {qs?.length === 0 && (
        <div className="rise card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">조건에 맞는 문제가 없어요</p>
          <button onClick={() => setQs(null)} className="btn btn-gray py-2.5 px-5 mt-3 text-[14px]">
            다시 고르기
          </button>
        </div>
      )}

      {/* 공부 모드 — 문제 옆에 정답·풀이 (데스크톱 2단, 모바일 세로) */}
      {study && q && (
        <div key={q.id} className="animate-pop grid gap-4 lg:grid-cols-2">
          <div className="card p-5 lg:p-6 flex flex-col gap-4">
            <div className="flex gap-1.5 flex-wrap">
              <span className="chip !py-0.5 !px-2 !text-[11px]">{q.typeTag}</span>
              <span className="chip !py-0.5 !px-2 !text-[11px]">{q.area}</span>
              <span className="chip !py-0.5 !px-2 !text-[11px]">{q.type === "theory" ? "이론" : "실무"}</span>
            </div>
            <StemView stem={q.stem} />
            {q.type === "theory" && (
              <div className="flex flex-col gap-2">
                {q.choices.map((c, i) => (
                  <div
                    key={i}
                    className="text-left rounded-[14px] border border-line px-4 py-3 text-[14px] leading-relaxed flex items-start gap-2.5"
                    style={q.answerIdx === i ? { borderColor: "var(--blue)", background: "var(--blue-weak)" } : {}}
                  >
                    <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                      {i + 1}
                    </span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card p-5 lg:p-6 flex flex-col gap-3 self-start">
            {q.type === "theory" ? (
              <>
                <p className="text-[13px] font-extrabold text-blue">정답 {(q.answerIdx ?? 0) + 1}번</p>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--sub-2)" }}>
                  {q.explanation || "이 문제는 해설이 없어요."}
                </p>
              </>
            ) : (
              <>
                <p className="text-[12px] font-bold text-blue">정답 (분개)</p>
                {q.answerText ? <JournalEntry text={q.answerText} /> : <p className="text-sub text-[13px]">정답 없음</p>}
                {q.explanation && (
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap mt-1" style={{ color: "var(--sub-2)" }}>
                    {q.explanation}
                  </p>
                )}
              </>
            )}
            <div className="flex gap-2 mt-1">
              <button onClick={() => studyGo(-1)} disabled={idx === 0} className="btn btn-gray flex-1 py-3 disabled:opacity-50">
                이전
              </button>
              <button
                onClick={() => studyGo(1)}
                disabled={idx >= qs!.length - 1}
                className="btn btn-primary flex-1 py-3 disabled:opacity-50"
              >
                다음
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 시험 모드 — 문제 */}
      {!study && q && !finished && (
        <div key={q.id} className="animate-pop card p-5 lg:p-6 flex flex-col gap-4">
          <div className="flex gap-1.5 flex-wrap">
            <span className="chip !py-0.5 !px-2 !text-[11px]">{q.typeTag}</span>
            <span className="chip !py-0.5 !px-2 !text-[11px]">{q.area}</span>
            <span className="chip !py-0.5 !px-2 !text-[11px]">
              {q.type === "theory" ? "이론" : "실무"}
            </span>
          </div>

          <StemView stem={q.stem} />

          {/* 이론 4지선다 */}
          {q.type === "theory" && (
            <div className="flex flex-col gap-2">
              {q.choices.map((c, i) => {
                const isPicked = picked === i;
                const isAnswer = graded?.answer === i;
                const style: React.CSSProperties = graded
                  ? isAnswer
                    ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
                    : isPicked
                      ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                      : {}
                  : {};
                return (
                  <button
                    key={i}
                    onClick={() => pick(i)}
                    disabled={!!graded}
                    style={style}
                    className="text-left rounded-[14px] border border-line px-4 py-3 text-[14px] leading-relaxed transition-colors disabled:cursor-default hover:border-[var(--blue)] flex items-start gap-2.5"
                  >
                    <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                      {i + 1}
                    </span>
                    <span>{c}</span>
                  </button>
                );
              })}
              {!graded && (
                <button onClick={giveUp} className="self-center text-sub text-[13px] py-1.5 hover:text-blue transition-colors">
                  몰라요, 못 풀겠어요 — 정답 보기
                </button>
              )}
            </div>
          )}

          {/* 실무 자가채점 */}
          {q.type === "practice" && (
            <div className="flex flex-col gap-3">
              {!revealed ? (
                <button onClick={() => setRevealed(true)} className="btn btn-primary py-3">
                  정답 보기
                </button>
              ) : (
                <>
                  <div className="rounded-[14px] border border-line p-4" style={{ background: "var(--blue-weak)" }}>
                    <p className="text-[12px] font-bold text-blue mb-2">정답 (분개)</p>
                    {q.answerText ? <JournalEntry text={q.answerText} /> : <p className="text-sub text-[13px]">정답 없음</p>}
                  </div>
                  {q.explanation && (
                    <div className="rounded-[14px] border border-line p-4">
                      <p className="text-[12px] font-bold text-sub mb-1.5">해설</p>
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{q.explanation}</p>
                    </div>
                  )}
                  {!selfDone ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => selfMark(true)}
                        className="btn flex-1 py-3"
                        style={{ background: "var(--blue-weak)", color: "var(--blue)" }}
                      >
                        맞혔어요
                      </button>
                      <button
                        onClick={() => selfMark(false)}
                        className="btn flex-1 py-3"
                        style={{ background: "var(--red-weak)", color: "var(--red)" }}
                      >
                        틀렸어요
                      </button>
                    </div>
                  ) : (
                    <p className="text-sub text-[13px] text-center">기록했어요.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* 이론 채점 결과 */}
          {graded && (
            <div className="flex flex-col gap-2">
              <p className="text-[14px] font-bold" style={{ color: graded.correct ? "var(--blue)" : "var(--red)" }}>
                {graded.correct
                  ? "정답이에요"
                  : picked === null
                    ? `정답은 ${graded.answer + 1}번이에요 — 오답노트에 담아뒀어요`
                    : `아쉬워요, 정답은 ${graded.answer + 1}번`}
              </p>
              {graded.explanation && (
                <div className="rounded-[14px] border border-line p-4">
                  <p className="text-[12px] font-bold text-sub mb-1.5">해설</p>
                  <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{graded.explanation}</p>
                </div>
              )}
            </div>
          )}

          {(graded || selfDone) && (
            <button onClick={next} className="btn btn-gray py-3">
              {idx + 1 >= (qs?.length ?? 0) ? "결과 보기" : "다음 문제"}
            </button>
          )}
        </div>
      )}

      {/* 결과 */}
      {finished && (
        <div className="rise card p-8 text-center flex flex-col gap-4">
          <div>
            <p className="text-[13px] text-sub">{qs!.length}문제 중</p>
            <p className="text-[40px] font-extrabold tabular-nums">
              {score.right}
              <span className="text-[20px] text-sub"> / {score.done}</span>
            </p>
            <p className="text-sub text-[14px] mt-1">
              {score.done > 0 ? `정답률 ${Math.round((score.right / score.done) * 100)}%` : ""}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={() => setQs(null)} className="btn btn-primary py-3">
              다른 문제 풀기
            </button>
            <Link href="/bank/notes" className="btn btn-gray py-3">
              오답노트 보기
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function StemView({ stem }: { stem: string }) {
  const { body, form } = splitStem(stem);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[16px] font-bold leading-relaxed whitespace-pre-wrap">{body}</p>
      {form && (
        <pre className="text-[12px] leading-snug overflow-x-auto rounded-[12px] border border-line p-3" style={{ background: "var(--fill-2)" }}>
          {form}
        </pre>
      )}
    </div>
  );
}

function Filter({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-bold text-sub">
        {label}
        {required && <span className="text-blue"> *</span>}
      </p>
      <div className="flex gap-1.5 flex-wrap">{children}</div>
    </div>
  );
}

function Chip({
  on,
  disabled,
  onClick,
  children,
}: {
  on?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`chip !text-[13px] ${on ? "chip-on" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}
