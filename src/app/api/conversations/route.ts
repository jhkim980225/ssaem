import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";

// 질문 이력 (강사·학생 공용 — role로 필터 분기).
// GET            → 내 대화 목록 (최신 50개, 메시지 수 포함. 학생은 강사 이름 포함)
// GET ?id=<uuid> → 해당 대화 메시지 전체 (당사자만)
export async function GET(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const { data: conv } = await db
      .from("conversations")
      .select("id, teacher_id, student_id")
      .eq("id", id)
      .maybeSingle();
    if (!conv || (conv.teacher_id !== uid && conv.student_id !== uid))
      return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data, error } = await db
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [] });
  }

  const { data: me } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
  const asStudent = me?.role === "student";

  const { data, error } = await db
    .from("conversations")
    .select(
      "id, title, created_at, teacher_id, messages(count), teacher:profiles!conversations_teacher_id_fkey(name)"
    )
    .eq(asStudent ? "student_id" : "teacher_id", uid)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; title: string | null; created_at: string; teacher_id: string;
    messages: { count: number }[];
    teacher: { name: string } | { name: string }[] | null;
  };
  const conversations = ((data ?? []) as Row[])
    .map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      teacher_id: c.teacher_id,
      teacher_name: Array.isArray(c.teacher) ? c.teacher[0]?.name ?? null : c.teacher?.name ?? null,
      messages: c.messages?.[0]?.count ?? 0,
    }))
    .filter((c) => c.messages > 0); // 중간 이탈로 빈 대화는 숨김
  return NextResponse.json({ conversations, role: asStudent ? "student" : "teacher" });
}
