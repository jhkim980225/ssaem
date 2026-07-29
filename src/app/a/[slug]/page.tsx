import { redirect } from "next/navigation";

// 학원 전용 진입 URL: /a/<slug> → 그 학원 강사만 보이는 질문 페이지.
// ponytail: 전용 랜딩 없이 redirect만 — 학원별 브랜딩 필요해지면 여기서 페이지로 승격.
export default async function AcademyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/ask?academy=${encodeURIComponent(slug)}`);
}
