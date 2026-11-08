"use client";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import JournalEntry from "@/components/JournalEntry";
import { StemView, ExplanationView, ChoiceView } from "@/components/BankQuestion";

type Q = {
  id: string;
  group: string;
  category: string;
  source: string | null;
  seq: number | null;
  stem: string;
  choices: string[] | null;
  answerIdx: number | null;
  answerText: string | null;
  explanation: string | null;
  images?: string[] | null;
};

// 유형별 일괄 출력 — /bank/print?subject=전산세무2급&kind=practice&category=일반전표
// 문제검색에서 들어온다. 다시 풀어 보고 오답노트에 정리하려고 종이로 뽑는 용도.
// 유형마다 문제지(번호·회차·지문) 다음에 정답지(번호·지문 + 정답·해설) — 회차별이 아니라 유형별로 묶는다.
type Mode = "both" | "questions" | "answers";
const MODES: [Mode, string][] = [
  ["both", "문제지 + 정답지"],
  ["questions", "문제지만"],
  ["answers", "정답지만"],
];

// 화면에서도 종이처럼(밝은 색) 보이고, 인쇄하면 사이트 머리·꼬리·버튼은 빠진다.
// 다크 모드 변수는 !important로 덮어야 [data-theme="dark"]보다 이긴다.
const PAPER_VARS = `--bg:#fff;--surface:#fff;--text:#111;--text-2:#333;--sub:#555;--sub-2:#444;--border:#d4d4d8;--fill:#f2f2f4;--fill-2:#f7f7f8;--blue:#1e3a5f;--blue-weak:#eef1fa;--red:#c53030;--green:#2f855a;--green-weak:#eaf5ee;--border-strong:#bbb`;
const CSS = `
.paper{${PAPER_VARS.replace(/;/g, " !important;")} !important;background:#fff;color:#111}
.paper .q{break-inside:avoid;page-break-inside:avoid}
.paper .stem *{font-size:14px !important;line-height:1.6 !important}
.paper .stem.small *{font-size:13px !important}
.paper .sec+.sec{break-before:page;page-break-before:always}
@media print{
  @page{size:A4;margin:14mm 12mm}
  :root{${PAPER_VARS.replace(/;/g, " !important;")} !important}
  html,body{background:#fff !important}
  body>header,body>footer,body>nav,.no-print{display:none !important}
  main.print-main{max-width:none !important;padding:0 !important}
  .paper{border:0 !important;box-shadow:none !important;padding:0 !important;border-radius:0 !important}
}`;

const roundLabel = (q: Q) => {
  const r = /(\d+)\s*회/.exec(q.source ?? "")?.[1];
  return [r && `${r}회`, q.seq && `${q.seq}번`].filter(Boolean).join(" ");
};

export default function BankPrintPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <PrintInner />
    </Suspense>
  );
}

function PrintInner() {
  const params = useSearchParams();
  const { session, gate } = useGate("any", { loginMessage: "출력은 로그인 후 쓸 수 있어요." });
  const token = session?.access_token;
  const subject = params.get("subject") ?? "";
  const kind = params.get("kind") === "theory" ? "theory" : "practice";
  const filter = (kind === "theory" ? params.get("area") : params.get("category")) ?? "";

  const [qs, setQs] = useState<Q[] | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<Mode>("both");

  useEffect(() => {
    if (!token) return;
    const p = new URLSearchParams({ subject, kind });
    if (filter) p.set(kind === "theory" ? "area" : "category", filter);
    fetch(`/api/bank/print?${p}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) return setErr(d?.error ?? "불러오지 못했어요.");
        setQs(d.questions ?? []);
      })
      .catch(() => setErr("불러오지 못했어요."));
  }, [token, subject, kind, filter]);

  // 유형별 묶음 (API가 유형 → 최근 회차 → 번호 순으로 준다)
  const groups = useMemo(() => {
    const m = new Map<string, Q[]>();
    for (const q of qs ?? []) m.set(q.group, [...(m.get(q.group) ?? []), q]);
    return [...m.entries()];
  }, [qs]);

  if (gate) return gate;

  const title = `${subject} ${kind === "theory" ? "이론" : "실무"}${filter ? ` · ${filter}` : ""}`;

  const stem = (q: Q, small?: boolean) => (
    <div className={small ? "stem small" : "stem"}>
      <StemView stem={q.stem} images={q.images} />
      {Array.isArray(q.choices) && q.choices.length > 0 && (
        <ol className="mt-1.5 flex flex-col gap-0.5">
          {q.choices.map((c, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="shrink-0">{"①②③④"[i]}</span>
              <span className="min-w-0">
                <ChoiceView text={c} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );

  const head = (n: number, q: Q) => (
    <p className="text-[14px] font-bold mb-1">
      {n}.{" "}
      <span className="font-normal text-[12px]" style={{ color: "var(--sub)" }}>
        {roundLabel(q)}
      </span>
    </p>
  );

  return (
    <main className="print-main flex-1 w-full max-w-4xl mx-auto px-4 lg:px-6 py-6 flex flex-col gap-4">
      <style>{CSS}</style>

      <div className="no-print flex flex-col gap-3">
        <BackButton fallback="/bank/browse?kind=practice" />
        <h1 className="text-[22px] lg:text-[26px] font-bold">{title} 출력</h1>
        <p className="text-sub text-[14px] break-keep">
          {qs ? `${qs.length}문제를 유형별로 묶었어요. ` : ""}최근 회차부터 실려 있어요. 인쇄 창에서 &lsquo;PDF로 저장&rsquo;을 고르면 파일로도 받을 수 있어요.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {MODES.map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} className={`chip !text-[14px] ${mode === m ? "chip-on font-bold" : ""}`}>
              {label}
            </button>
          ))}
          <button onClick={() => window.print()} disabled={!qs?.length} className="btn btn-primary h-10 px-5 ml-auto disabled:opacity-50">
            인쇄하기
          </button>
        </div>
        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}
        {!qs && !err && <div className="skel h-40 !rounded-[12px]" />}
      </div>

      {qs && qs.length === 0 && <p className="text-sub text-[14px] text-center py-10">이 조건에 맞는 문제가 없어요.</p>}

      {qs && qs.length > 0 && (
        <div className="paper rounded-[12px] border p-6 lg:p-10 flex flex-col">
          {/* 유형마다 문제지 → 정답지 (일반전표 문제·정답, 매입매출 문제·정답 …) */}
          {groups.map(([g, list]) => (
            <Fragment key={g}>
              {mode !== "answers" && (
                <section key={`q-${g}`} className="sec flex flex-col gap-5">
                  <h2 className="text-[20px] font-bold border-b-2 pb-2" style={{ borderColor: "#111" }}>
                    {subject} {g} <span className="text-[14px] font-normal">· 문제 {list.length}개</span>
                  </h2>
                  {list.map((q, i) => (
                    <div key={q.id} className="q">
                      {head(i + 1, q)}
                      {stem(q)}
                    </div>
                  ))}
                </section>
              )}
              {mode !== "questions" && (
                <section key={`a-${g}`} className="sec flex flex-col gap-5">
                  <h2 className="text-[20px] font-bold border-b-2 pb-2" style={{ borderColor: "#111" }}>
                    {subject} {g} <span className="text-[14px] font-normal">· 정답·해설</span>
                  </h2>
                  {list.map((q, i) => (
                    <div key={q.id} className="q flex flex-col gap-2 pb-4 border-b" style={{ borderColor: "var(--border)" }}>
                      {head(i + 1, q)}
                      {stem(q, true)}
                      {q.answerText && (
                        <div className="rounded-[8px] border p-3" style={{ borderColor: "var(--border)" }}>
                          <p className="text-[12px] font-bold mb-1">정답 (분개)</p>
                          <JournalEntry text={q.answerText} />
                        </div>
                      )}
                      {q.answerIdx !== null && Array.isArray(q.choices) && q.choices.length > 0 && (
                        <p className="text-[14px] font-bold">정답 {"①②③④"[q.answerIdx]}</p>
                      )}
                      {q.explanation && (
                        <div className="text-[13px]">
                          <p className="text-[12px] font-bold mb-0.5">해설</p>
                          <ExplanationView text={q.explanation} />
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </main>
  );
}
