import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { teacherFromRequest } from "@/lib/auth";

// 강사용 질문 이력.
// GET            → 내 대화 목록 (최신 50개, 메시지 수 포함)
// GET ?id=<uuid> → 해당 대화 메시지 전체 (본인 것만)
export async function GET(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const { data: conv } = await db
      .from("conversations")
      .select("id")
      .eq("id", id)
      .eq("teacher_id", uid)
      .maybeSingle();
    if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data, error } = await db
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  }

  const { data, error } = await db
    .from("conversations")
    .select("id, title, created_at, messages(count)")
    .eq("teacher_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; title: string | null; created_at: string; messages: { count: number }[] };
  const conversations = ((data ?? []) as Row[])
    .map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      messages: c.messages?.[0]?.count ?? 0,
    }))
    .filter((c) => c.messages > 0); // 중간 이탈로 빈 대화는 숨김
  return NextResponse.json({ conversations });
}
