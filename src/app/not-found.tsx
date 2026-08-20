import Link from "next/link";

// 404 — 없는 주소로 들어왔을 때 (오타 링크, 지워진 강좌 등)
export default function NotFound() {
  return (
    <main className="flex-1 grid place-items-center px-5 py-16">
      <div className="card p-8 text-center max-w-sm w-full">
        <p className="text-[40px] font-extrabold tabular-nums text-blue">404</p>
        <p className="font-bold text-[16px] mt-1">페이지를 찾을 수 없어요</p>
        <p className="text-sub text-[14px] mt-1.5 leading-relaxed">
          주소가 바뀌었거나 지워진 페이지예요. 링크를 다시 확인해 주세요.
        </p>
        <Link href="/" className="btn btn-primary py-3 px-6 inline-block mt-5">
          홈으로 가기
        </Link>
      </div>
    </main>
  );
}
