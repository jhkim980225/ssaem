"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";

type Insights = {
  days: number;
  from: string;
  to: string;
  totals: { questions: number; answers: number; up: number; down: number };
  daily: { date: string; count: number }[];
  lowRated: { question: string; answer: string; rating: number; created_at: string }[];
  weak: { question: string; created_at: string; reason: string }[];
};

type Solving = {
  totals: { attempts: number; correct: number; active: number; students: number };
  students: { id: string; name: string; attempts: number; correct: number; lastAt: string; recent: { q: string; ok: boolean; at: string }[] }[];
  missed: { q: string; tries: number; wrong: number; students: string[] }[];
  exams: { name: string; subject: string; source: string | null; score: number; total: number; at: string }[];
  questions: Record<string, { subject: string; category: string; source: string | null; seq: number | null; text: string }>;
};

// 기간: 미리 정한 일수 또는 직접 고른 날짜 (한국 날짜)
type Range = { days: number } | { from: string; to: string };
const PRESETS = [7, 14, 30, 90, 365];
const presetLabel = (n: number) => (n === 365 ? "1년" : `${n}일`);
const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

const md = (d: string) => d.slice(5).replace("-", "/");
const ymd = (d: string) => d.replaceAll("-", ".");
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export default function InsightsPage() {
  const { session, gate, allowed } = useGate("teacher");
  const [range, setRange] = useState<Range>({ days: 14 });
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [data, setData] = useState<Insights | null>(null);
  const [solving, setSolving] = useState<Solving | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null); // 펼친 학생

  const query = "days" in range ? `days=${range.days}` : `from=${range.from}&to=${range.to}`;

  useEffect(() => {
    if (!allowed || !session) return;
    let live = true;
    const h = { headers: { Authorization: `Bearer ${session.access_token}` } };
    const get = (u: string) => fetch(u, h).then((r) => r.json());
    Promise.all([get(`/api/insights?${query}`), get(`/api/insights/solving?${query}`)])
      .then(([d, s]) => {
        if (!live) return;
        if (d.error || s.error) return setErr(d.error || s.error);
        setErr("");
        setData(d);
        setSolving(s);
      })
      .catch(() => live && setErr("불러오기 실패"));
    return () => {
      live = false;
    };
  }, [allowed, session, query]);

  if (gate) return gate;

  function pick(r: Range) {
    setData(null);
    setSolving(null);
    setOpen(null);
    setRange(r);
  }

  // 62일이 넘으면 막대를 주 단위로 묶는다 (1년이면 365개 막대는 못 읽는다)
  const weekly = (data?.daily.length ?? 0) > 62;
  const bars = !data
    ? []
    : weekly
      ? Array.from({ length: Math.ceil(data.daily.length / 7) }, (_, i) => {
          const wk = data.daily.slice(i * 7, i * 7 + 7);
          return { date: wk[0].date, end: wk[wk.length - 1].date, count: wk.reduce((n, d) => n + d.count, 0) };
        })
      : data.daily.map((d) => ({ ...d, end: d.date }));
  const max = Math.max(1, ...bars.map((d) => d.count));
  const span = (d: string) => (data && data.from.slice(0, 4) !== data.to.slice(0, 4) ? ymd(d) : md(d));

  const qLabel = (id: string) => {
    const q = solving?.questions[id];
    if (!q) return "";
    return `${q.source ?? q.subject}${q.seq ? ` ${q.seq}번` : ""}${q.category !== "이론" ? ` · ${q.category}` : ""}`;
  };

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">인사이트</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">
          {data ? `${span(data.from)} ~ ${span(data.to)} (${data.days}일)` : "기간"} 학생 질문·답변 품질과 문제 풀이 기록이에요.
        </p>
      </div>

      {/* 기간 고르기 */}
      <div className="rise flex flex-wrap items-center gap-1.5">
        {PRESETS.map((n) => (
          <button
            key={n}
            onClick={() => pick({ days: n })}
            className={`chip !text-[14px] ${"days" in range && range.days === n ? "chip-on font-bold" : ""}`}
          >
            {presetLabel(n)}
          </button>
        ))}
        <span className="flex items-center gap-1.5 w-full sm:w-auto sm:ml-1">
          <input
            type="date"
            className="field !py-1.5 !text-[14px] min-w-0 flex-1 sm:!w-auto sm:flex-none"
            value={custom.from}
            max={custom.to || today()}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            aria-label="시작일"
          />
          <span className="text-sub">~</span>
          <input
            type="date"
            className="field !py-1.5 !text-[14px] min-w-0 flex-1 sm:!w-auto sm:flex-none"
            value={custom.to}
            min={custom.from || undefined}
            max={today()}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            aria-label="종료일"
          />
          <button
            onClick={() => pick({ from: custom.from, to: custom.to || today() })}
            disabled={!custom.from}
            className={`chip !text-[14px] whitespace-nowrap shrink-0 ${"from" in range ? "chip-on font-bold" : ""}`}
          >
            조회
          </button>
        </span>
      </div>

      {err && (
        <p className="text-[13px]" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}

      {!data && !err && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-24 !rounded-[16px]" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* 스탯 타일 */}
          <div className="rise d1 grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3">
            {(
              [
                ["질문", data.totals.questions, undefined],
                ["답변", data.totals.answers, undefined],
                ["도움됨", data.totals.up, "var(--blue)"],
                ["아쉬움", data.totals.down, "var(--red)"],
              ] as const
            ).map(([label, n, color]) => (
              <div key={label} className="card !rounded-[14px] p-4 lg:px-5 lg:py-[18px]">
                <p className="text-sub text-[13px] lg:text-[14px]">{label}</p>
                <p className="text-[24px] lg:text-[28px] font-bold tabular-nums mt-1" style={color ? { color } : undefined}>
                  {n}
                </p>
              </div>
            ))}
          </div>

          {/* 일별 질문 추이 — 단일 시리즈 막대 (범례 불필요). 가장 많은 날만 진하게 */}
          <section className="rise d2 card p-5 lg:p-6">
            <div className="flex items-baseline justify-between mb-5">
              <h2 className="font-bold text-[17px] lg:text-[19px]">{weekly ? "주별" : "일별"} 질문 수</h2>
              <span className="text-sub text-[13px]">최대 {max}건</span>
            </div>
            {data.totals.questions === 0 ? (
              <p className="text-sub text-[14px] py-6 text-center">이 기간에 질문이 없어요.</p>
            ) : (
              <div className="flex items-end gap-px lg:gap-1 h-36 lg:h-44" role="img" aria-label={`${weekly ? "주별" : "일별"} 질문 수 막대 그래프`}>
                {bars.map((d) => (
                  <div key={d.date} className="group relative flex-1 h-full flex flex-col justify-end items-center">
                    <span className="pointer-events-none absolute -top-6 hidden group-hover:block text-[11px] whitespace-nowrap rounded-md px-1.5 py-0.5 border border-line card z-10">
                      {md(d.date)}
                      {weekly && `~${md(d.end)}`} · {d.count}건
                    </span>
                    <div
                      className="w-full rounded-t-[6px] rounded-b-[2px]"
                      style={{
                        background: "var(--blue)",
                        opacity: d.count === max ? 1 : 0.22,
                        height: `${(d.count / max) * 100}%`,
                        minHeight: d.count > 0 ? 3 : 0,
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between mt-2 text-sub text-[12px]">
              <span>{span(data.from)}</span>
              <span>{span(data.to)}</span>
            </div>
          </section>

          {solving && (
            <section className="rise d2 card p-5 lg:p-6 flex flex-col gap-4 min-w-0">
              <div>
                <h2 className="font-bold text-[17px] lg:text-[19px]">문제 풀이</h2>
                <p className="text-sub text-[13px] mt-1">
                  수강 학생 {solving.totals.students}명 중 {solving.totals.active}명이 기출·실무 문제를 풀었어요.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 lg:gap-3">
                {(
                  [
                    ["푼 문제", `${solving.totals.attempts}`],
                    ["정답률", solving.totals.attempts ? `${pct(solving.totals.correct, solving.totals.attempts)}%` : "-"],
                    ["푼 학생", `${solving.totals.active}명`],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-[12px] p-3.5" style={{ background: "var(--fill-2)" }}>
                    <p className="text-sub text-[13px]">{label}</p>
                    <p className="text-[20px] lg:text-[22px] font-bold tabular-nums mt-0.5">{v}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
                {/* 학생별 — 누르면 그 학생이 푼 문제 */}
                <div className="min-w-0">
                  <h3 className="font-bold text-[15px] mb-2">학생별</h3>
                  {solving.students.length === 0 ? (
                    <p className="text-sub text-[14px] py-4 text-center border-t border-line">수강 연결된 학생이 없어요</p>
                  ) : (
                    solving.students.map((s) => (
                      <div key={s.id} className="border-t border-line min-w-0">
                        <button
                          onClick={() => setOpen(open === s.id ? null : s.id)}
                          disabled={s.attempts === 0}
                          className="w-full py-3 flex items-center gap-3 text-left disabled:cursor-default"
                          aria-expanded={open === s.id}
                        >
                          <span className="font-bold text-[15px] truncate min-w-0 flex-1">{s.name}</span>
                          {s.attempts === 0 ? (
                            <span className="text-sub text-[13px]">안 풀었어요</span>
                          ) : (
                            <>
                              <span className="text-[13px] tabular-nums text-sub shrink-0">{when(s.lastAt).split(" ")[0]}</span>
                              <span className="text-[14px] tabular-nums shrink-0">{s.attempts}문제</span>
                              <span
                                className="text-[14px] font-bold tabular-nums w-11 text-right shrink-0"
                                style={{ color: pct(s.correct, s.attempts) < 60 ? "var(--red)" : "var(--blue)" }}
                              >
                                {pct(s.correct, s.attempts)}%
                              </span>
                              <span className="text-sub text-[12px] shrink-0">{open === s.id ? "▲" : "▼"}</span>
                            </>
                          )}
                        </button>
                        {open === s.id && (
                          <ul className="pb-3 flex flex-col gap-1.5">
                            {s.recent.map((r, i) => (
                              <li key={i} className="flex items-start gap-2 text-[13px] min-w-0">
                                <span
                                  className="shrink-0 w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold text-white"
                                  style={{ background: r.ok ? "var(--blue)" : "var(--red)" }}
                                  aria-label={r.ok ? "맞음" : "틀림"}
                                >
                                  {r.ok ? "O" : "X"}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="font-semibold">{qLabel(r.q)}</span>
                                  <span className="block text-sub truncate">{solving.questions[r.q]?.text}</span>
                                </span>
                                <span className="text-sub tabular-nums shrink-0">{when(r.at)}</span>
                              </li>
                            ))}
                            {s.attempts > s.recent.length && (
                              <li className="text-sub text-[12px]">최근 {s.recent.length}개만 보여요 (전체 {s.attempts}개)</li>
                            )}
                          </ul>
                        )}
                      </div>
                    ))
                  )}
                </div>

                <div className="flex flex-col gap-4 min-w-0">
                  {/* 많이 틀린 문제 */}
                  <div className="min-w-0">
                    <h3 className="font-bold text-[15px] mb-2">많이 틀린 문제</h3>
                    {solving.missed.length === 0 ? (
                      <p className="text-sub text-[14px] py-4 text-center border-t border-line">틀린 문제가 없어요</p>
                    ) : (
                      solving.missed.map((m) => (
                        <div key={m.q} className="py-3 border-t border-line min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-[14px] truncate">{qLabel(m.q)}</span>
                            <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--red)" }}>
                              {m.students.length}명 틀림
                            </span>
                          </div>
                          <p className="text-[13px] text-sub truncate">{solving.questions[m.q]?.text}</p>
                          <p className="text-[12px] text-sub mt-0.5 truncate">
                            {m.students.join(", ")} · 오답 {m.wrong}/{m.tries}회
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  {/* 회차 시험(CBT) 점수 */}
                  <div className="min-w-0">
                    <h3 className="font-bold text-[15px] mb-2">시험 기록</h3>
                    {solving.exams.length === 0 ? (
                      <p className="text-sub text-[14px] py-4 text-center border-t border-line">이 기간에 본 시험이 없어요</p>
                    ) : (
                      solving.exams.map((e, i) => (
                        <div key={i} className="py-2.5 border-t border-line flex items-center gap-3 text-[14px] min-w-0">
                          <span className="font-bold shrink-0">{e.name}</span>
                          <span className="text-sub truncate min-w-0 flex-1">{e.source ?? `${e.subject} 랜덤`}</span>
                          <span className="font-bold tabular-nums shrink-0">
                            {e.score}/{e.total}
                          </span>
                          <span className="text-sub text-[13px] tabular-nums shrink-0">{when(e.at).split(" ")[0]}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 아래 두 카드는 PC에서 나란히 — 각각 목록이 짧아 세로로 쌓으면 여백만 커진다 */}
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
          {/* 낮은 평점 답변 */}
          <section className="rise d3 card p-5 lg:p-6 flex flex-col min-w-0">
            <h2 className="font-bold text-[17px] lg:text-[19px] mb-3">아쉬웠던 답변</h2>
            {data.lowRated.length === 0 ? (
              <p className="text-sub text-[14px] py-4 text-center border-t border-line">낮은 평가를 받은 답변이 없어요</p>
            ) : (
              data.lowRated.map((r, i) => (
                <div key={i} className="py-3.5 border-t border-line min-w-0">
                  <p className="text-[15px] font-bold mb-1 break-words">
                    <span className="text-blue">Q.</span> {r.question || "(질문 없음)"}
                  </p>
                  <p className="text-[14px] leading-relaxed truncate" style={{ color: "var(--sub-2)" }}>
                    <b>A.</b> {r.answer}…
                  </p>
                </div>
              ))
            )}
          </section>

          {/* 자료 공백 */}
          <section className="rise d4 card p-5 lg:p-6 flex flex-col min-w-0">
            <h2 className="font-bold text-[17px] lg:text-[19px]">자료가 부족했던 질문</h2>
            <p className="text-sub text-[13px] mt-1 mb-3">
              근거 자료 없이 답했거나 관련도가 낮았어요 — 이 주제 자료를 추가해 보세요.
            </p>
            {data.weak.length === 0 ? (
              <p className="text-sub text-[14px] py-4 text-center border-t border-line">자료 공백이 발견되지 않았어요</p>
            ) : (
              data.weak.map((w, i) => (
                <div key={i} className="py-3.5 border-t border-line flex items-start gap-2.5 min-w-0">
                  <span
                    className="inline-flex items-center h-6 px-2 rounded-[8px] text-[12px] font-bold shrink-0"
                    style={{ background: "var(--fill)", color: "var(--sub-2)" }}
                  >
                    {w.reason}
                  </span>
                  <p className="text-[15px] min-w-0 break-words">{w.question || "(질문 없음)"}</p>
                </div>
              ))
            )}
          </section>
          </div>
        </>
      )}
    </main>
  );
}
