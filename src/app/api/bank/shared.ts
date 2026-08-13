import type { serviceClient } from "@/lib/supabase";

type Db = ReturnType<typeof serviceClient>;

// 문제은행에서 "마지막 시도가 오답"인 문항 id 집합. 다시 맞히면 자동으로 빠진다.
// (quiz의 wrongQuestionIds와 같은 계산이지만 테이블이 달라 별도. 공용 헬퍼 추출은 후속.)
export async function lastWrongBankIds(db: Db, userId: string): Promise<Set<string>> {
  const { data } = await db
    .from("bank_attempts")
    .select("question_id, is_correct, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(2000);
  const last = new Map<string, boolean>();
  for (const a of (data ?? []) as { question_id: string; is_correct: boolean }[])
    last.set(a.question_id, a.is_correct);
  return new Set([...last.entries()].filter(([, ok]) => !ok).map(([id]) => id));
}
