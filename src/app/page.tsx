import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex-1 flex flex-col items-center justify-center px-5 py-16 overflow-hidden">
      {/* 은은한 블루 글로우 배경 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[480px] rounded-full opacity-60"
        style={{ background: "radial-gradient(closest-side, rgba(49,130,246,0.12), transparent)" }}
      />

      <div className="relative w-full max-w-md lg:max-w-2xl flex flex-col items-center text-center">
        <span className="rise chip chip-on mb-6 !cursor-default">✨ AI 튜터</span>
        <h1 className="rise d1 text-[32px] lg:text-[46px] leading-[1.25] font-extrabold tracking-tight">
          우리 선생님 자료로
          <br />
          답해주는 AI
        </h1>
        <p className="rise d2 mt-4 text-[15px] lg:text-[17px] text-sub leading-relaxed">
          강사님이 문제와 풀이를 등록하면
          <br className="lg:hidden" /> 학생은 그 자료를 근거로 답변을 받아요.
        </p>

        <div className="rise d3 mt-10 w-full max-w-md flex flex-col sm:flex-row gap-3">
          <Link href="/teacher" className="btn btn-primary flex-1 py-4 text-[16px] text-center">
            강사로 시작하기
          </Link>
          <Link href="/ask" className="btn btn-ghost flex-1 py-4 text-[16px] text-center">
            학생으로 질문하기
          </Link>
        </div>

        <div className="mt-14 grid grid-cols-3 gap-3 lg:gap-4 w-full">
          {[
            ["📚", "자료 등록", "문제·풀이·PDF"],
            ["⚡", "자동 학습", "청킹·검색"],
            ["💬", "근거 답변", "등록 자료 기반"],
          ].map(([e, t, s], i) => (
            <div key={t} className={`rise d${i + 4} card card-hover p-4 lg:p-6 text-center`}>
              <p className="text-[22px] lg:text-[28px]">{e}</p>
              <p className="mt-2 text-[13px] lg:text-[15px] font-bold">{t}</p>
              <p className="mt-0.5 text-[11px] lg:text-[13px] text-sub">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
