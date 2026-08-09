import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";

const DAYS = 14;
const PREVIEW = 80;

// 강사 인사이트: 질문 추이 · 평가 · 자료 공백(근거 약한 답변).
// ponytail: 최근 1000개 메시지 JS 집계 — 학원 규모에선 충분, 느려지면 SQL 집계 RPC로.
export async function GET(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  const db = serviceClient();
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("messages")
    .select(
      "id, conversation_id, role, content, created_at, conversations!inner(teacher_id), message_feedback(rating), message_citations(similarity)"
    )
    .eq("conversations.teacher_id", uid)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    message_feedback: { rating: number } | { rating: number }[] | null;
    message_citations: { similarity: number | null }[];
  };
  const rows = (data ?? []) as unknown as Row[];
  const ratingOf = (m: Row): number | null => {
    const f = m.message_feedback;
    return Array.isArray(f) ? f[0]?.rating ?? null : f?.rating ?? null;
  };

  // 일별 질문 수 (오늘 포함 최근 DAYS일, 빈 날은 0)
  const daily: { date: string; count: number }[] = [];
  const byDate = new Map<string, number>();
  for (const m of rows)
    if (m.role === "user") {
      const d = m.created_at.slice(0, 10);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    daily.push({ date: d, count: byDate.get(d) ?? 0 });
  }

  // 답변별 직전 질문 매칭 (대화 내 시간순)
  const lastUserByConv = new Map<string, string>();
  const lowRated: { question: string; answer: string; rating: number; created_at: string }[] = [];
  const weak: { question: string; created_at: string; reason: string }[] = [];
  let up = 0;
  let down = 0;
  let answers = 0;

  for (const m of rows) {
    if (m.role === "user") {
      lastUserByConv.set(m.conversation_id, m.content);
      continue;
    }
    answers++;
    const question = lastUserByConv.get(m.conversation_id) ?? "";
    const rating = ratingOf(m);
    if (rating !== null) {
      if (rating >= 4) up++;
      else if (rating <= 2) down++;
      if (rating <= 2)
        lowRated.push({
          question: question.slice(0, PREVIEW),
          answer: m.content.slice(0, PREVIEW),
          rating,
          created_at: m.created_at,
        });
    }
    // 자료 공백: 근거 청크가 아예 없거나 최고 유사도가 낮음 (null 유사도=렉시컬은 판단 제외)
    const sims = m.message_citations.map((c) => c.similarity).filter((s): s is number => s !== null);
    if (m.message_citations.length === 0)
      weak.push({ question: question.slice(0, PREVIEW), created_at: m.created_at, reason: "근거 자료 없음" });
    else if (sims.length && Math.max(...sims) < 0.45)
      weak.push({
        question: question.slice(0, PREVIEW),
        created_at: m.created_at,
        reason: `유사도 낮음 (${Math.max(...sims).toFixed(2)})`,
      });
  }

  return NextResponse.json({
    days: DAYS,
    totals: {
      questions: rows.filter((m) => m.role === "user").length,
      answers,
      up,
      down,
    },
    daily,
    lowRated: lowRated.slice(-10).reverse(),
    weak: weak.slice(-10).reverse(),
  });
}
