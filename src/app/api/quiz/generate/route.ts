import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { teacherFromRequest } from "@/lib/auth";
import { generateQuestions } from "@/lib/quiz";
import { hasLlmKey } from "@/lib/anthropic";
import { rateLimit } from "@/lib/ratelimit";

export const maxDuration = 60; // LLM 출제는 기본 타임아웃 안에 안 끝날 수 있음

// 강사가 올린 자료 → LLM이 객관식 문제로 정리해 저장.
// POST { documentId, count? }
export async function POST(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasLlmKey())
    return NextResponse.json({ error: "AI 키가 설정되지 않아 문제를 만들 수 없어요." }, { status: 503 });
  // 출제는 LLM 비용이 커서 강사당 분당 5회
  if (!rateLimit(`quizgen:${uid}`, 5, 60_000))
    return NextResponse.json({ error: "문제 생성이 너무 잦아요. 잠시 후 다시 해주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const documentId = (body?.documentId ?? "").toString();
  const count = Math.min(Math.max(Number(body?.count) || 5, 1), 10);
  if (!documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

  const db = serviceClient();
  // 소유권 — 남의 자료로 출제 못 하게
  const { data: doc } = await db
    .from("documents")
    .select("id, title, raw_text, course_id")
    .eq("id", documentId)
    .eq("teacher_id", uid)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  let made;
  try {
    made = await generateQuestions(doc.raw_text, count);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("quiz generate:", msg);
    return NextResponse.json({ error: `문제를 만들지 못했어요: ${msg.slice(0, 120)}` }, { status: 502 });
  }
  if (!made.length)
    return NextResponse.json(
      { error: "이 자료로는 문제를 만들기 어려워요. 내용이 짧거나 정답을 확정하기 어려운 자료예요." },
      { status: 422 }
    );

  const { data: saved, error } = await db
    .from("quiz_questions")
    .insert(
      made.map((q) => ({
        teacher_id: uid,
        document_id: doc.id,
        course_id: doc.course_id,
        question: q.question,
        choices: q.choices,
        answer: q.answer,
        explanation: q.explanation,
      }))
    )
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, created: saved?.length ?? 0 });
}

// 강사가 자기 문제 목록 조회 (?documentId= 로 자료별)
export async function GET(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const documentId = new URL(req.url).searchParams.get("documentId");
  const db = serviceClient();
  let q = db
    .from("quiz_questions")
    .select("id, question, choices, answer, explanation, document_id, created_at")
    .eq("teacher_id", uid)
    .order("created_at", { ascending: false })
    .limit(200);
  if (documentId) q = q.eq("document_id", documentId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questions: data ?? [] });
}

// 문제 삭제 (?id=) — LLM이 이상하게 만든 문제를 강사가 걷어낼 수 있게
export async function DELETE(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await serviceClient()
    .from("quiz_questions")
    .delete()
    .eq("id", id)
    .eq("teacher_id", uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
