import Link from "next/link";
import { SHOW_PRICING } from "@/lib/flags";
import { version } from "../../package.json";

export default function SiteFooter() {
  return (
    <footer className="border-t border-line mt-16">
      <div className="mx-auto w-full max-w-[1600px] px-5 lg:px-8 py-10 flex flex-col gap-8">
        <div className="flex flex-col sm:flex-row sm:justify-between gap-8">
          <div className="max-w-xs">
            <p className="flex items-center gap-2 font-extrabold text-[15px]">
              <span className="grid place-items-center w-7 h-7 rounded-[9px] bg-blue text-white text-[12px] font-extrabold">마</span>
              마스터 전산회계 학원
            </p>
          </div>

          <div className="flex gap-14">
            <div>
              <p className="text-[12px] font-bold text-sub mb-3">학생</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <li><Link href="/ask" className="hover:text-blue transition-colors">질문하기</Link></li>
                <li><Link href="/quiz" className="hover:text-blue transition-colors">문제풀이</Link></li>
                <li><Link href="/quiz/notes" className="hover:text-blue transition-colors">오답노트</Link></li>
                <li><Link href="/my/history" className="hover:text-blue transition-colors">내 대화내역</Link></li>
                <li><Link href="/install" className="hover:text-blue transition-colors">앱 설치</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-[12px] font-bold text-sub mb-3">학원</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <li><Link href="/admin" className="hover:text-blue transition-colors">학원장</Link></li>
                {SHOW_PRICING && (
                  <li><Link href="/pricing" className="hover:text-blue transition-colors">요금제</Link></li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-[12px] font-bold text-sub mb-3">강사</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                <li><Link href="/teacher" className="hover:text-blue transition-colors">대시보드</Link></li>
                <li><Link href="/teacher/insights" className="hover:text-blue transition-colors">인사이트</Link></li>
                <li><Link href="/teacher/history" className="hover:text-blue transition-colors">질문 이력</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-6 border-t border-line">
          {/* 배포본이 실제로 갱신됐는지 눈으로 확인하는 용도 — package.json version을 올릴 것 */}
          <p className="text-[12px] text-sub">© {new Date().getFullYear()} 마스터 전산회계 학원 · v{version}</p>
          <div className="flex items-center gap-3 text-[12px] text-sub">
            <Link href="/legal/terms" className="hover:text-blue transition-colors">이용약관</Link>
            <span>·</span>
            <Link href="/legal/privacy" className="hover:text-blue transition-colors">개인정보처리방침</Link>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">전산회계 2급 · 1급 · 전산세무 2급 지원</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
