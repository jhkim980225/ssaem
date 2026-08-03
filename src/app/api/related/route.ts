import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { score } from "@/lib/lexical";
import { rateLimit, clientIp } from "@/lib/ratelimit";

const MIN_SCORE = 6; // 이 미만이면 관련 없다고 보고 미노출 (빈 추천이 오답 추천보다 낫다)

// 유사 질문 추천: 같은 강사에게 온 과거 질문 중 비슷한 것 (클라썸 도트 패턴).
// 임베딩 없는 messages라 lexical 랭킹 재활용 — 공개 데이터(질문 텍스트만) 반환.
export async function GET(req: Request) {
  if (!rateLimit(`related:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ related: [] });

  const url = new URL(req.url);
  const teacherId = (url.searchParams.get("teacher") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 500);
  if (!/^[0-9a-f-]{36}$/i.test(teacherId) || q.length < 4)
    return NextResponse.json({ related: [] });

  const db = serviceClient();
  const { data } = await db
    .from("messages")
    .select("content, conversations!inner(teacher_id)")
    .eq("role", "user")
    .eq("conversations.teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(200);

  const seen = new Set<string>([q]);
  const related = ((data ?? []) as { content: string }[])
    .map((m) => ({ text: m.content.trim().slice(0, 120), s: score(q, m.content) }))
    .filter((m) => m.s >= MIN_SCORE && m.text.length >= 4 && !seen.has(m.text) && seen.add(m.text))
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((m) => m.text);

  return NextResponse.json({ related });
}
