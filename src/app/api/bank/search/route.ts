import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 문제모음 검색: 급수(과목) + 키워드 → 지문에 키워드가 포함된 문제 전부 (정답·해설 포함, 열람용).
// GET ?subject=전산회계2급&q=재무
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`banksearch:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const subject = (url.searchParams.get("subject") ?? "").trim().slice(0, 30);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
  if (!subject || q.length < 2)
    return NextResponse.json({ error: "subject와 두 글자 이상 검색어가 필요해요" }, { status: 400 });

  const db = serviceClient();
  // ilike 특수문자(%, _)는 그대로 두면 와일드카드로 동작 — 이스케이프
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { data, error, count } = await db
    .from("bank_questions")
    .select("id, category, type_tag, area, source, stem, choices, answer_idx, answer_text, explanation, images", {
      count: "exact",
    })
    .eq("subject", subject)
    .ilike("stem", like)
    .order("source", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const questions = (data ?? []).map((r) => ({
    id: r.id,
    category: r.category,
    typeTag: r.type_tag,
    area: r.area,
    source: r.source,
    stem: r.stem,
    choices: r.choices,
    answerIdx: r.answer_idx,
    answerText: r.answer_text,
    explanation: r.explanation,
    images: r.images ?? null,
  }));
  return NextResponse.json({ questions, total: count ?? questions.length });
}
