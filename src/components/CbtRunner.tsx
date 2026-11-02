"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  StemView,
  ExplanationView,
  ChoiceView,
  TAG,
  TAG_FILL,
  CHOICE_BOX,
  CHOICE_NUM,
  choiceTone,
} from "@/components/BankQuestion";
import { ExcelTry } from "@/components/ExcelPad";

// 기출 CBT 모드 — 실제 시험처럼 푼다.
//  · 푸는 동안: 한 문제씩 한 줄로. 이전/다음으로 오가고 **마지막 문항에서 '다음'이
//    '채점하기'로 바뀐다**. 사이드바(번호판·채점 버튼)는 두지 않는다 — 문제 옆에 붙어
//    읽는 폭을 좁히고, 모바일에선 번호판이 문제 위에 쌓여 첫 화면을 다 먹었다.
//    번호 바로가기는 문제 **아래**에 작게 둔다 (첫 화면은 문제가 차지).
//  · 답만 체크하고 마지막에 **한 번에 채점**. 덜 푼 문항이 있으면 채점 전에 묻는다
//  · 채점 뒤: **전 문항을 세로로 펼친다** — 시험지 되돌아보듯 아래로 훑으며 틀린 문제와
//    해설을 확인한다. 한 문제씩 오가는 방식은 어디를 틀렸는지 한눈에 안 보였다
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
        <span className={TAG} style={{ background: "var(--blue)", color: "#fff", fontWeight: 700 }}>
          {n}번
        </span>
        <span className={TAG} style={TAG_FILL}>
          {item.typeTag}
        </span>
        <span className={TAG} style={TAG_FILL}>
          {item.area}
        </span>
        {g && (
          <span
            className="ml-auto text-[13px] font-bold shrink-0"
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
          const tone = choiceTone(g ? (ci === g.answerIdx ? "on" : mine ? "bad" : null) : mine ? "on" : null);
          return (
            <button
              key={ci}
              onClick={() => !locked && onPick(ci)}
              disabled={locked}
              style={tone.box}
              className={`${CHOICE_BOX} disabled:cursor-default hover:border-[var(--blue)]`}
            >
              <span className={CHOICE_NUM} style={tone.num}>
                {ci + 1}
              </span>
              <span className="flex-1 min-w-0">
                <ChoiceView text={c} />
              </span>
              {g && ci === g.answerIdx && <span className="text-[12px] font-bold text-blue shrink-0 mt-0.5">정답</span>}
              {g && mine && ci !== g.answerIdx && (
                <span className="text-[12px] font-bold shrink-0 mt-0.5" style={{ color: "var(--red)" }}>
                  내 답
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 컴활 2과목 — 엑셀 연습장 (다른 영역이면 안 그린다) */}
      <ExcelTry area={item.area} stem={item.stem} choices={item.choices} />

      {/* 채점 후 해설 */}
      {g && (
        <div className="flex flex-col gap-2">
          <p className="text-[15px] font-bold" style={{ color: g.correct ? "var(--blue)" : "var(--red)" }}>
            {g.correct ? "정답이에요" : `틀렸어요 — 정답은 ${g.answerIdx + 1}번`}
          </p>
          {g.explanation && (
            <div className="rounded-[12px] p-4" style={{ background: "var(--fill-2)" }}>
              <p className="text-[13px] font-bold mb-1.5">해설</p>
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
          // 답한 순서(Object.entries)가 아니라 **출제 순서**로 보낸다 — 이전으로 돌아가 답을
          // 고치면 답한 순서가 시험지 순서와 어긋난다. 서버가 이 순서를 문항 번호로 저장한다.
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

  // ── 채점 후: 점수 카드 + 전 문항을 세로로 펼쳐 아래로 훑어본다
  if (graded) {
    const list = wrongOnly ? questions.filter((item) => gradedBy.get(item.id)?.correct === false) : questions;
    const rate = graded.length ? Math.round((score / graded.length) * 100) : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 min-h-[44px]">
          <h2 className="text-[16px] font-bold truncate">{title} 채점 결과</h2>
          <button onClick={onExit} aria-label="닫기" className="w-11 h-11 -mr-2.5 grid place-items-center shrink-0">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <section className="card p-5 lg:p-6">
          <p className="text-sub text-[14px]">채점 완료</p>
          <p className="text-[32px] font-bold tabular-nums mt-1 mb-3">
            {score} <span className="text-[20px] text-sub">/ {graded.length}점</span>{" "}
            <span className="text-[18px] text-blue">{rate}%</span>
          </p>
          <div className="flex h-2.5 rounded-full overflow-hidden gap-0.5" style={{ background: "var(--fill)" }}>
            <div style={{ flex: score, background: "var(--blue)" }} />
            <div style={{ flex: wrongCount, background: "var(--red-weak)" }} />
          </div>
          <p className="mt-3 px-3.5 py-3 rounded-[8px] text-[14px]" style={{ background: "var(--fill-2)", color: "var(--sub-2)" }}>
            틀린 문제는 오답노트에 담겼어요.
          </p>
        </section>

        <div role="tablist" aria-label="문항 필터" className="flex items-center gap-2 flex-wrap">
          <button
            role="tab"
            aria-selected={!wrongOnly}
            onClick={() => setWrongOnly(false)}
            className={`chip h-10 ${!wrongOnly ? "chip-on" : ""}`}
          >
            전체 {questions.length}
          </button>
          <button
            role="tab"
            aria-selected={wrongOnly}
            onClick={() => setWrongOnly(true)}
            disabled={wrongCount === 0}
            className={`chip h-10 ${wrongOnly ? "chip-on" : ""} disabled:opacity-50`}
          >
            틀린 문제 {wrongCount}
          </button>
        </div>

        <div className="flex flex-col gap-3">
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

        <div className="grid grid-cols-2 gap-2 mt-1">
          <Link
            href="/my/records"
            className="btn grid place-items-center h-[50px] text-[16px] border border-line"
            style={{ background: "var(--surface)" }}
          >
            내 기록 보기
          </Link>
          <button onClick={onExit} className="btn btn-primary h-[50px] text-[16px]">
            다른 문제 풀기
          </button>
        </div>
      </div>
    );
  }

  // ── 푸는 중: 한 문제씩, 한 줄로. 채점 사이드바는 두지 않는다 —
  //    이전/다음으로 오가고 **마지막 문항에서 '다음'이 '채점하기'로 바뀐다**.
  //    (사이드바가 문제 옆에 붙어 있으면 읽는 폭을 좁히고, 모바일에선 번호판이
  //     문제 위에 쌓여 첫 화면을 다 먹었다 — 바로가기는 문제 아래에 작게)
  const isLast = idx >= questions.length - 1;
  return (
    <div className="flex flex-col gap-4">
      {/* 상단 — 나가기 · 제목 · 진행 + 진행 막대 */}
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-h-[44px]">
          <button
            onClick={onExit}
            className="h-9 px-3 -ml-1 rounded-[8px] text-[15px] font-semibold"
            style={{ color: "var(--sub-2)" }}
          >
            나가기
          </button>
          <h2 className="text-[16px] font-bold truncate text-center">{title}</h2>
          <span className="text-[15px] font-bold text-blue tabular-nums text-right min-w-[60px]">
            {idx + 1} / {questions.length}
          </span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--fill)" }}>
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${((idx + 1) / questions.length) * 100}%`, background: "var(--blue)" }}
          />
        </div>
      </div>

      <div key={q.id} className="animate-pop">
        <QuestionCard item={q} n={idx + 1} g={undefined} mineIdx={picked[q.id]} locked={false} onPick={pick(q.id)} />
      </div>

      {/* 문항 바로가기 — 지금 문항(네이비) · 푼 문항(연한 네이비) · 안 푼 문항(회색) */}
      <div>
        <p className="text-[13px] font-bold text-sub mb-2.5">문항 바로가기 · {answered}개 풀었어요</p>
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(28px,1fr))]">
          {questions.map((item, i) => {
            const cur = i === idx;
            const done = picked[item.id] !== undefined;
            return (
              <button
                key={item.id}
                onClick={() => setIdx(i)}
                aria-label={`${i + 1}번 문항${done ? " (풀었음)" : ""}`}
                aria-current={cur ? "step" : undefined}
                className="h-8 rounded-[8px] text-[12px] tabular-nums"
                style={
                  cur
                    ? { background: "var(--blue)", color: "#fff", fontWeight: 700 }
                    : done
                      ? { background: "var(--blue-weak)", color: "var(--blue)", fontWeight: 700 }
                      : { background: "var(--fill)", color: "var(--sub)" }
                }
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* 이동 — 터치하기 편하게 50px. 마지막 문항이면 오른쪽이 채점하기 */}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button
          onClick={() => setIdx((i) => Math.max(i - 1, 0))}
          disabled={idx === 0}
          className="btn btn-gray h-[50px] text-[17px] disabled:opacity-50"
        >
          이전
        </button>
        {isLast ? (
          <button onClick={submit} disabled={busy} className="btn btn-primary h-[50px] text-[17px] disabled:opacity-60">
            {busy ? "채점 중…" : `채점하기 (${answered}/${questions.length})`}
          </button>
        ) : (
          <button
            onClick={() => setIdx((i) => Math.min(i + 1, questions.length - 1))}
            className="btn btn-primary h-[50px] text-[17px]"
          >
            다음
          </button>
        )}
      </div>

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
    </div>
  );
}
