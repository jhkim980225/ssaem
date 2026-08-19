import { Suspense } from "react";
import TeacherSidebar from "@/components/TeacherSidebar";

// 강사 영역 전체(/teacher/*)에 사이드바를 깐다. 비로그인·타 역할이면 사이드바가 스스로 숨는다.
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 w-full max-w-[1700px] mx-auto lg:flex lg:items-start">
      {/* useSearchParams를 쓰는 클라이언트 컴포넌트라 Suspense 필수 */}
      <Suspense fallback={null}>
        <TeacherSidebar />
      </Suspense>
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
