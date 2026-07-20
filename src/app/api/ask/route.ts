import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { retrieve } from "@/lib/retrieve";
import { generateStream, llmModel, hasLlmKey } from "@/lib/anthropic";
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

  // 강사 조회 + 청크 검색(질문 임베딩 포함) + 대화 맥락 — 서로 독립이라 병렬
  const [{ data: teacher }, hits, priorRes] = await Promise.all([
    db
      .from("profiles")
      .select("name, teacher_profiles(subject)")
      .eq("id", teacherId)
      .eq("role", "teacher")
      .maybeSingle(),
    retrieve(teacherId, question, 5),
    conversationId
      ? db
          .from("messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT)
      : Promise.resolve({ data: null }),
  ]);
  if (!teacher) return NextResponse.json({ error: "teacher not found" }, { status: 404 });
  const tp = Array.isArray(teacher.teacher_profiles) ? teacher.teacher_profiles[0] : teacher.teacher_profiles;

  const system = buildTutorSystem(
    { name: teacher.name, subject: tp?.subject },
    hits
  );

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

  const history: { role: "user" | "assistant"; content: string }[] = [];
  if (priorRes.data) history.push(...(priorRes.data.reverse() as typeof history));

  // 스트리밍 전에 conversation 확보 → 헤더로 ID 전달
  if (!conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .insert({ teacher_id: teacherId, title: question.slice(0, 60) })
      .select("id")
      .single();
    conversationId = conv?.id ?? null;
  }

  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      // 클라이언트가 중간에 끊어도(탭 닫기) throw로 이력 저장까지 죽지 않게 가드
      const push = (t: string) => {
        try {
          controller.enqueue(encoder.encode(t));
        } catch {}
      };
      try {
        for await (const delta of generateStream(system, [
          ...history,
          { role: "user", content: question },
        ])) {
          answer += delta;
          push(delta);
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : "unknown";
        // 무료 쿼터 초과는 학생에게 친절하게 (영문 quota 에러 원문 노출 방지)
        const msg = /429|quota|rate/i.test(raw)
          ? "⚠️ 지금 질문이 몰려 있어요. 잠시 후(1분 정도) 다시 시도해 주세요."
          : `⚠️ 답변 생성 실패: ${raw.slice(0, 120)}`;
        if (!answer) push(msg);
        console.error("generate:", raw);
      }
      try {
        controller.close();
      } catch {}

      // 이력 기록 (실패해도 답변엔 영향 없음)
      try {
        if (!conversationId || !answer) return;
        await db.from("messages").insert({ conversation_id: conversationId, role: "user", content: question });
        const { data: am } = await db
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: answer,
            model: llmModel(),
            latency_ms: Date.now() - started,
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
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(conversationId ? { "X-Conversation-Id": conversationId } : {}),
    },
  });
}
