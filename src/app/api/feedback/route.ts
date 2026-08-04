import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 답변 피드백. 익명 학생도 가능 — 익명 대화는 conversationId(uuid)가 자격 토큰.
// 로그인 학생 대화는 본인만 평가 가능 (남의 평점 덮어쓰기 차단).
// 클라이언트는 message id를 모름(스트리밍) → 해당 대화의 마지막 assistant 메시지에 기록.
export async function POST(req: Request) {
  if (!rateLimit(`feedback:${clientIp(req)}`, 30, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const body = await req.json().catch(() => null);
  const conversationId = (body?.conversationId ?? "").toString();
  const rating = Number(body?.rating);
  const comment = (body?.comment ?? "").toString().slice(0, 500) || null;
  if (!conversationId || !Number.isInteger(rating) || rating < 1 || rating > 5)
    return NextResponse.json({ error: "conversationId, rating(1~5) required" }, { status: 400 });

  const db = serviceClient();

  // 소유권: 로그인 학생 대화면 본인만. 익명 대화(student_id NULL)는 UUID 보유자 허용.
  const { data: conv } = await db
    .from("conversations")
    .select("student_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (conv.student_id !== null) {
    const uid = await userFromRequest(req);
    if (uid !== conv.student_id)
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: msg } = await db
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!msg) return NextResponse.json({ error: "no answer to rate" }, { status: 404 });

  const { error } = await db
    .from("message_feedback")
    .upsert({ message_id: msg.id, rating, comment });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
