"use client";
import Link from "next/link";

// 가입 화면 공통 약관 동의 (필수). 서버 /api/signup도 agree 없으면 400 — 여기는 안내용.
// 링크는 새 탭 — 같은 탭으로 가면 입력하던 가입 폼이 날아간다.
export default function AgreeTerms({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2.5 text-[14px] text-sub leading-relaxed cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] w-[20px] h-[20px] shrink-0 accent-[var(--blue)]"
      />
      <span>
        <Link href="/legal/terms" target="_blank" className="font-semibold text-text underline underline-offset-2">
          이용약관
        </Link>
        과{" "}
        <Link href="/legal/privacy" target="_blank" className="font-semibold text-text underline underline-offset-2">
          개인정보처리방침
        </Link>
        에 동의해요 <span className="text-blue font-semibold">(필수)</span>
      </span>
    </label>
  );
}
