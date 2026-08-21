"use client";
import Link from "next/link";
import { SHOW_PRICING } from "@/lib/flags";
import { useAuth } from "@/lib/auth-store";
import { version } from "../../package.json";

// 헤더와 같은 원칙: 내 역할의 링크만 보여준다 — 학생에게 학원장/강사 메뉴를 깔아봐야
// 눌러도 거부 화면만 나온다. 비로그인(랜딩)은 안내판이므로 전부 보여준다.
export default function SiteFooter() {
  const { status, role } = useAuth();
  const signedIn = status === "signed-in";
  // role이 아직 확정 안 된 계정(강사 가입 직후 등)은 전부 노출
  const showStudent = !signedIn || role === "student" || role === null || role === undefined;
  const showTeacher = !signedIn || role === "teacher" || role === null || role === undefined;
  const showAdmin = !signedIn || role === "admin" || role === null || role === undefined;

  const item = (href: string, label: string) => (
    <li key={href}>
      <Link href={href} className="hover:text-blue transition-colors">
        {label}
      </Link>
    </li>
  );

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

          <div className="flex flex-wrap gap-x-14 gap-y-8">
            {showStudent && (
              <div>
                <p className="text-[12px] font-bold text-sub mb-3">학생</p>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {item("/ask", "질문하기")}
                  {item("/quiz", "문제풀이")}
                  {item("/quiz/notes", "오답노트")}
                  {item("/my", "마이페이지")}
                  {item("/my/history", "내 대화내역")}
                  {item("/my/reviews", "선생님 평가")}
                </ul>
              </div>
            )}
            {showAdmin && (
              <div>
                <p className="text-[12px] font-bold text-sub mb-3">학원</p>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {item("/admin", "학원장")}
                  {SHOW_PRICING && item("/pricing", "요금제")}
                </ul>
              </div>
            )}
            {showTeacher && (
              <div>
                <p className="text-[12px] font-bold text-sub mb-3">강사</p>
                <ul className="flex flex-col gap-2 text-[13px]">
                  {item("/teacher", "대시보드")}
                  {item("/teacher/insights", "인사이트")}
                  {item("/teacher/history", "질문 이력")}
                </ul>
              </div>
            )}
            <div>
              <p className="text-[12px] font-bold text-sub mb-3">공용</p>
              <ul className="flex flex-col gap-2 text-[13px]">
                {item("/bank", "기출문제")}
                {item("/bank/browse", "문제검색(이론)")}
                {item("/bank/browse?kind=practice", "문제검색(실무)")}
                {item("/install", "앱 설치")}
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
