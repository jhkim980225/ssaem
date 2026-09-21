"use client";
import { useMemo, useState } from "react";
import { StemView, ExplanationView, ChoiceView } from "@/components/BankQuestion";

// 기출 CBT 모드 — 실제 시험처럼 푼다.
//  · 푸는 동안: 번호판으로 아무 문항이나 바로 이동 (푼 문제는 색이 찬다). PC에선 우측 sticky
//  · 한 문제씩 보며 답만 체크하고, 마지막에 **한 번에 채점**
//  · 채점 뒤: 번호판·점수 카드를 걷어내고 **전 문항을 세로로 펼친다** — 시험지 되돌아보듯
//    아래로 훑으며 틀린 문제와 해설을 확인한다. 번호판을 눌러 한 문제씩 오가는 방식은
//    어디를 틀렸는지 한눈에 안 보이고, 다 확인했는지도 알 수 없었다.
//
// 즉시채점(기존 방식)과 달리 중간에 답을 바꿀 수 있다 — 시험이니까.

export type CbtQuestion = { id: string; type: "theory"; stem: string; choices: string[]; area: string; typeTag: string; images?: string[] | null };
type Graded = { questionId: string; chosen: number; correct: boolean; answerIdx: number; explanation: string };

// 문제 한 장 — 푸는 중(선택 가능)과 채점 후(정오·해설)를 같은 모양으로 그린다.
// 컴포넌트 밖에 둔다: 안에 두면 렌더마다 타입이 새로 만들어져 펼친 문항 전체가 리마운트된다.
function QuestionCard({
  item,
  n,
  g,
  mineIdx,
  locked,
  onPick,
}: {
  item: CbtQuestion;
  n: number;
  g: Graded | undefined;
  mineIdx: number | undefined;
  locked: boolean;
  onPick: (choiceIdx: number) => void;
}) {
  return (
    <div className="card p-5 lg:p-7 flex flex-col gap-4">
      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{n}번</span>
        <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{item.typeTag}</span>
        <span className="chip !py-0.5 !px-2 !text-[11px] !cursor-default">{item.area}</span>
        {g && (
          <span
            className="ml-auto text-[12px] font-extrabold shrink-0"
            style={{ color: g.correct ? "var(--blue)" : "var(--red)" }}
          >
            {g.correct ? "정답" : "오답"}
          </span>
        )}
      </div>

      <StemView stem={item.stem} images={item.images} />

      <div className="flex flex-col gap-2.5">
        {item.choices.map((c, ci) => {
          const mine = mineIdx === ci;
          const style: React.CSSProperties = g
            ? ci === g.answerIdx
              ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
              : mine
                ? { borderColor: "var(--red)", background: "var(--red-weak)" }
                : {}
            : mine
              ? { borderColor: "var(--blue)", background: "var(--blue-weak)" }
              : {};
          return (
            <button
              key={ci}
              onClick={() => !locked && onPick(ci)}
              disabled={locked}
              style={style}
              className="text-left rounded-[14px] border border-line px-4 py-3.5 min-h-[54px] text-[15px] leading-[1.65] break-keep flex items-start gap-3 transition-colors disabled:cursor-default hover:border-[var(--blue)]"
            >
              <span className="shrink-0 grid place-items-center w-5 h-5 mt-0.5 rounded-full border border-current text-[11px] font-extrabold">
                {ci + 1}
              </span>
              <span className="flex-1 min-w-0">
                <ChoiceView text={c} />
              </span>
              {g && ci === g.answerIdx && <span className="text-[11px] font-bold text-blue shrink-0">정답</span>}
              {g && mine && ci !== g.answerIdx && (
                <span className="text-[11px] font-bold shrink-0" style={{ color: "var(--red)" }}>
                  내 답
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 채점 후 해설 */}
      {g && (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-extrabold" style={{ color: g.correct ? "var(--blue)" : "var(--red)" }}>
            {g.correct ? "정답이에요" : `틀렸어요 — 정답은 ${g.answerIdx + 1}번`}
          </p>
          {g.explanation && (
            <div className="rounded-[14px] p-4" style={{ background: "var(--fill-2)" }}>
              <ExplanationView text={g.explanation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CbtRunner({
  token,
  questions,
  title,
  subject,
  source,
  onExit,
}: {
  token: string | undefined;
  questions: CbtQuestion[];
  title: string;
  subject: string;
  source: string | null;
  onExit: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [graded, setGraded] = useState<Graded[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [wrongOnly, setWrongOnly] = useState(false); // 채점 후 훑어보기: 전체 / 틀린 것만

  const gradedBy = useMemo(() => {
    const m = new Map<string, Graded>();
    for (const g of graded ?? []) m.set(g.questionId, g);
    return m;
  }, [graded]);

  const answered = Object.keys(picked).length;
  const q = questions[idx];
  const score = (graded ?? []).filter((r) => r.correct).length;
  const wrongCount = (graded ?? []).length - score;

  const pick = (qid: string) => (ci: number) => setPicked((p) => ({ ...p, [qid]: ci }));

  async function submit() {
    if (busy || !token) return;
    // 한 문제도 안 풀었으면 서버까지 갈 것 없이 안내 (서버 400 원문이 그대로 뜨던 것 방지)
    if (answered === 0) {
      setErr("아직 푼 문제가 없어요. 문제를 풀고 채점해 주세요.");
      return;
    }
    const unanswered = questions.length - answered;
    if (unanswered > 0 && !confirm(`아직 ${unanswered}문항이 비어 있어요. 채점할까요?`)) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/bank/attempt", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          // 답한 순서(Object.entries)가 아니라 **출제 순서**로 보낸다 — 번호판으로 아무 문항이나
          // 오갈 수 있어 답한 순서는 시험지 순서와 무관하다. 서버가 이 순서를 문항 번호로 저장한다.
          answers: questions
            .filter((item) => picked[item.id] !== undefined)
            .map((item) => ({ questionId: item.id, chosen: picked[item.id] })),
          // 시험 기록(bank_sessions)용 — 마이페이지·이름 검색에서 조회
          subject,
          source,
        }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(d?.error ?? "채점하지 못했어요.");
        return;
      }
      setGraded(d.results ?? []);
      // 채점 뒤에는 전 문항을 펼쳐 보므로 풀던 문항 번호는 의미가 없다 — 맨 위부터 읽게 한다
      setIdx(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErr("채점하지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!q) return null;

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[18px] font-extrabold truncate">{title}</h2>
        <p className="text-sub text-[13px]">
          {graded
            ? `채점 완료 · ${score} / ${graded.length}점 (정답률 ${graded.length ? Math.round((score / graded.length) * 100) : 0}%)`
            : `${questions.length}문항 · ${answered}개 풀었어요`}
        </p>
      </div>
      <button onClick={onExit} className="chip !text-[13px] shrink-0">
        나가기
      </button>
    </div>
  );

  // ── 채점 후: 전 문항을 세로로 펼쳐 아래로 훑어본다 (번호판·점수 카드 없음)
  if (graded) {
    const list = wrongOnly ? questions.filter((item) => gradedBy.get(item.id)?.correct === false) : questions;
    return (
      <div className="flex flex-col gap-4">
        {header}

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setWrongOnly(false)} className={`chip !text-[13px] ${!wrongOnly ? "chip-on" : ""}`}>
            전체 {questions.length}
          </button>
          <button
            onClick={() => setWrongOnly(true)}
            disabled={wrongCount === 0}
            className={`chip !text-[13px] ${wrongOnly ? "chip-on" : ""} disabled:opacity-50`}
          >
            틀린 문제 {wrongCount}
          </button>
          <span className="text-[12px] text-sub">틀린 문제는 오답노트에 담겼어요.</span>
        </div>

        <div className="flex flex-col gap-4">
          {list.length === 0 ? (
            <div className="card p-6 text-center text-[14px] text-sub">틀린 문제가 없어요. 전부 맞혔습니다.</div>
          ) : (
            list.map((item, i) => (
              <QuestionCard
                key={item.id}
                item={item}
                n={wrongOnly ? questions.findIndex((x) => x.id === item.id) + 1 : i + 1}
                g={gradedBy.get(item.id)}
                mineIdx={picked[item.id]}
                locked
                onPick={pick(item.id)}
              />
            ))
          )}
        </div>

        <button onClick={onExit} className="btn btn-primary py-4 min-h-[52px]">
          다른 문제 풀기
        </button>
      </div>
    );
  }

  // ── 푸는 중: 한 문제씩 + 번호판(PC 우측 sticky)
  return (
    <div className="flex flex-col gap-4">
      {header}

      {/* PC(lg~): 문제 65 : 번호판·채점 35(sticky). 모바일: 번호판 → 문제 → 채점 세로 */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)] lg:gap-6 lg:items-start">
        {/* 문제 */}
        <div className="order-2 lg:order-1 flex flex-col gap-4 min-w-0">
          <div key={q.id} className="animate-pop">
            <QuestionCard
              item={q}
              n={idx + 1}
              g={undefined}
              mineIdx={picked[q.id]}
              locked={false}
              onPick={pick(q.id)}
            />
          </div>

          {/* 이동 — 터치하기 편하게 동일폭·52px */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => setIdx((i) => Math.max(i - 1, 0))}
              disabled={idx === 0}
              className="btn btn-gray py-3.5 min-h-[52px] disabled:opacity-50"
            >
              이전
            </button>
            <button
              onClick={() => setIdx((i) => Math.min(i + 1, questions.length - 1))}
              disabled={idx >= questions.length - 1}
              className="btn btn-gray py-3.5 min-h-[52px] disabled:opacity-50"
            >
              다음
            </button>
          </div>

          {err && (
            <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
              {err}
            </p>
          )}
        </div>

        {/* 번호판 + 채점 — PC에선 스크롤해도 따라오게 sticky */}
        <div className="order-1 lg:order-2 flex flex-col gap-4 min-w-0 lg:sticky lg:top-[76px]">
          <div className="card p-3">
            <div className="grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-6 gap-1.5">
              {questions.map((item, i) => {
                const done = picked[item.id] !== undefined;
                const style: React.CSSProperties = done
                  ? { background: "var(--blue-weak)", color: "var(--blue)", borderColor: "var(--blue)" }
                  : {};
                return (
                  <button
                    key={item.id}
                    onClick={() => setIdx(i)}
                    style={style}
                    className={`h-9 rounded-[10px] border border-line text-[13px] font-bold tabular-nums transition-colors ${
                      i === idx ? "ring-2 ring-[var(--blue)] ring-offset-1" : ""
                    }`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={submit} disabled={busy} className="btn btn-primary py-4 min-h-[52px] disabled:opacity-60">
            {busy ? "채점 중…" : `채점하기 (${answered}/${questions.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
