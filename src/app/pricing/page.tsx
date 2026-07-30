"use client";
import { useState } from "react";
import { FREE_LIMITS } from "@/lib/plan";

// 요금제 + 도입 문의 (docs/수익화-플랜.md — 단일 플랜 카드, 비교표 없음)
export default function PricingPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/inquiry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.get("name"),
        contact: f.get("contact"),
        message: f.get("message"),
        academySlug: f.get("academySlug"),
      }),
    }).catch(() => null);
    const d = await res?.json().catch(() => null);
    setBusy(false);
    if (res?.ok) setSent(true);
    else setErr(d?.error ?? "접수 실패 — 잠시 후 다시 시도해 주세요.");
  }

  return (
    <main className="flex-1 px-5 py-12">
      <div className="mx-auto w-full max-w-2xl flex flex-col items-center">
        <h1 className="rise text-[28px] lg:text-[36px] font-extrabold tracking-tight text-center">
          학원 하나, 플랜 하나
        </h1>
        <p className="rise d1 mt-3 text-[15px] text-sub text-center leading-relaxed">
          무료로 시작하고, 학원 전체에 쓸 때 Pro로 전환하세요.
        </p>

        {/* 플랜 카드 */}
        <div className="rise d2 mt-10 w-full grid gap-4 sm:grid-cols-2">
          <div className="card p-7 flex flex-col">
            <p className="text-[15px] font-bold">무료</p>
            <p className="mt-3 text-[32px] font-extrabold tracking-tight">
              0원<span className="text-[15px] font-bold text-sub"> /월</span>
            </p>
            <ul className="mt-5 flex flex-col gap-2.5 text-[14px] text-sub-2">
              <li>강사당 자료 {FREE_LIMITS.docsPerTeacher}건</li>
              <li>학원당 질문 일 {FREE_LIMITS.questionsPerDay}건</li>
              <li>텍스트·텍스트 PDF 등록</li>
              <li>질문 이력·인사이트</li>
            </ul>
            <p className="mt-auto pt-6 text-[13px] text-sub">지금 이대로 — 결제 없이 체험</p>
          </div>

          <div className="card p-7 flex flex-col border-2 !border-[var(--blue)]">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-blue">Pro</p>
              <span className="chip chip-on !cursor-default !px-3 !py-1 !text-[12px]">학원 단위</span>
            </div>
            <p className="mt-3 text-[32px] font-extrabold tracking-tight">
              99,000원<span className="text-[15px] font-bold text-sub"> /월</span>
            </p>
            <ul className="mt-5 flex flex-col gap-2.5 text-[14px] text-sub-2">
              <li>강사·자료·질문 무제한</li>
              <li>스캔 PDF OCR 등록</li>
              <li>원장 대시보드·강사별 통계</li>
              <li>도입·운영 지원 (카카오톡/전화)</li>
            </ul>
            <a href="#inquiry" className="btn btn-primary mt-6 py-3.5 text-center text-[15px]">
              도입 문의하기
            </a>
          </div>
        </div>

        {/* 환산 근거 — 배지·별점 대신 숫자. 포지셔닝: 관리 도구가 아니라 강사 시간 절약 */}
        <p className="rise d3 mt-6 text-[13px] text-sub text-center leading-relaxed">
          반복 질문 응대 하루 1시간이면 강사 인건비 월 수십만 원.
          <br />
          Pro는 질문 3,000건 기준 1건당 33원에 그 시간을 돌려드려요.
        </p>

        {/* 도입 문의 */}
        <div id="inquiry" className="rise d4 mt-12 w-full card p-7">
          <h2 className="text-[18px] font-extrabold">도입 문의</h2>
          <p className="mt-1.5 text-[14px] text-sub">
            남겨주시면 하루 안에 연락드려요. 결제는 계좌이체로 진행됩니다.
          </p>
          {sent ? (
            <p className="animate-pop mt-6 rounded-[14px] bg-[var(--blue-weak)] px-5 py-4 text-[14px] font-bold text-blue">
              접수됐어요. 곧 연락드릴게요!
            </p>
          ) : (
            <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="name" required maxLength={50} placeholder="이름" className="field" />
                <input name="contact" required maxLength={100} placeholder="연락처 (전화·이메일)" className="field" />
              </div>
              <input name="academySlug" maxLength={50} placeholder="학원 주소 slug (있다면)" className="field" />
              <textarea name="message" maxLength={1000} rows={3} placeholder="궁금한 점 (선택)" className="field resize-none" />
              {err && <p className="text-[13px] font-bold text-[var(--red)]">{err}</p>}
              <button type="submit" disabled={busy} className="btn btn-primary py-3.5 text-[15px]">
                {busy ? "접수 중…" : "문의 보내기"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
