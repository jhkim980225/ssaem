import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-md flex flex-col items-center text-center animate-pop">
        <span className="chip chip-on mb-6 !cursor-default">AI 튜터</span>
        <h1 className="text-[32px] leading-tight font-extrabold tracking-tight">
          선생님 말투 그대로,
          <br />
          답해주는 AI
        </h1>
        <p className="mt-4 text-[15px] text-sub leading-relaxed">
          강사님이 문제와 말투를 등록하면
          <br />
          학생은 그 선생님 스타일로 답변을 받아요.
        </p>

        <div className="mt-10 w-full flex flex-col gap-3">
          <Link href="/teacher" className="btn btn-primary py-4 text-[16px]">
            강사로 시작하기
          </Link>
          <Link href="/ask" className="btn btn-ghost py-4 text-[16px]">
            학생으로 질문하기
          </Link>
        </div>

        <div className="mt-12 grid grid-cols-3 gap-3 w-full">
          {[
            ["자료 등록", "문제·PDF·말투"],
            ["자동 학습", "청킹·검색"],
            ["말투 답변", "그 선생님처럼"],
          ].map(([t, s]) => (
            <div key={t} className="card p-4 text-center">
              <p className="text-[13px] font-bold">{t}</p>
              <p className="mt-1 text-[11px] text-sub">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
