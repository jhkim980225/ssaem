import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { retrieve } from "@/lib/retrieve";
import { generate, hasLlmKey } from "@/lib/anthropic";
import { buildTutorSystem } from "@/lib/prompt";

const HISTORY_LIMIT = 10; // 직전 메시지 N개만 맥락으로 (토큰 방어)

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const teacherId = (body?.teacherId ?? "").toString();
  const question = (body?.question ?? "").toString().trim();
  let conversationId: string | null = (body?.conversationId ?? null) as string | null;
  if (!teacherId || !question)
    return NextResponse.json({ error: "teacherId, question required" }, { status: 400 });

  const db = serviceClient();

  // 강사 정보
  const { data: teacher } = await db
    .from("profiles")
    .select("name, teacher_profiles(subject, tone_note)")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();
  if (!teacher) return NextResponse.json({ error: "teacher not found" }, { status: 404 });
  const tp = Array.isArray(teacher.teacher_profiles) ? teacher.teacher_profiles[0] : teacher.teacher_profiles;

  // 관련 청크 검색
  const hits = await retrieve(teacherId, question, 5);
  const system = buildTutorSystem(
    { name: teacher.name, subject: tp?.subject, tone_note: tp?.tone_note },
    hits
  );

  // 대화 맥락 (이어지는 질문 지원)
  const history: { role: "user" | "assistant"; content: string }[] = [];
  if (conversationId) {
    const { data: prior } = await db
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (prior) history.push(...(prior.reverse() as typeof history));
  }

  // ponytail: LLM 키 전무하면 답변 생성 생략, 검색 결과만 반환 (비용 0 체험 모드)
  if (!hasLlmKey()) {
    const preview = hits
      .map((h, i) => `[근거 ${i + 1}] ${h.content.slice(0, 200)}`)
      .join("\n\n");
    return NextResponse.json({
      answer:
        `⚠️ AI 답변 생성 꺼짐 (API 키 미설정).\n관련 자료 ${hits.length}개 검색됨:\n\n` +
        (preview || "관련 자료 없음."),
      used: hits.length,
      conversationId,
    });
  }

  const started = Date.now();
  const { text: answer, model: usedModel } = await generate(system, [
    ...history,
    { role: "user", content: question },
  ]);
  const latency = Date.now() - started;

  // 이력 기록 (실패해도 답변엔 영향 없음)
  try {
    if (!conversationId) {
      const { data: conv, error } = await db
        .from("conversations")
        .insert({ teacher_id: teacherId, title: question.slice(0, 60) })
        .select("id")
        .single();
      if (error) throw error;
      conversationId = conv.id;
    }
    await db.from("messages").insert({ conversation_id: conversationId, role: "user", content: question });
    const { data: am } = await db
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "assistant",
        content: answer,
        model: usedModel,
        latency_ms: latency,
      })
      .select("id")
      .single();
    if (am && hits.length) {
      await db.from("message_citations").insert(
        hits.map((h) => ({ message_id: am.id, chunk_id: h.id, similarity: h.similarity ?? null }))
      );
    }
  } catch (e) {
    console.error("history write:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ answer, used: hits.length, conversationId });
}
