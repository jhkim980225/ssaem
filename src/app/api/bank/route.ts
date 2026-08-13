import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { lastWrongBankIds } from "./shared";

// 문제은행 조회. **전역 공용 데이터** — 학원 경계 없음. @/lib/tenant 를 import하지 않는다.
//
// 파라미터 없음                     → 필터 트리(subject/area/category/type_tag 문항수)
// ?subject=&category=&area=&type_tag=&mode=all|wrong&limit=  → 문제 세트
//
// 이론(4지선다)은 answer_idx·explanation을 응답에서 뺀다 — 채점(POST attempt) 때만 준다.
// 실무·결산은 자가채점이라 answer_text·explanation을 함께 준다(클라가 '정답 보기'로 공개).

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;

  const url = new URL(req.url);
  const subject = (url.searchParams.get("subject") ?? "").trim();
  const category = (url.searchParams.get("category") ?? "").trim();
  const area = (url.searchParams.get("area") ?? "").trim();
  const typeTag = (url.searchParams.get("type_tag") ?? "").trim();
  const mode = url.searchParams.get("mode") === "wrong" ? "wrong" : "all";
  const hasFilter = Boolean(url.searchParams.get("subject") || mode === "wrong");
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const db = serviceClient();

  // 파라미터 없으면 필터 트리 (뷰 집계 — 1000행 캡 무관)
  if (!hasFilter) {
    const { data, error } = await db
      .from("bank_tag_counts")
      .select("subject, area, category, type_tag, count");
    if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });
    return NextResponse.json({ tree: data ?? [] });
  }

  // 문제 세트
  let q = db
    .from("bank_questions")
    .select("id, stem, category, choices, answer_text, explanation, area, type_tag")
    .limit(400);
  if (subject) q = q.eq("subject", subject);
  if (category) q = q.eq("category", category);
  if (area) q = q.eq("area", area);
  if (typeTag) q = q.eq("type_tag", typeTag);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });

  type Row = {
    id: string;
    stem: string;
    category: string;
    choices: string[] | null;
    answer_text: string | null;
    explanation: string | null;
    area: string;
    type_tag: string;
  };
  let rows = (data ?? []) as Row[];

  if (mode === "wrong") {
    const wrong = await lastWrongBankIds(db, g.uid);
    rows = rows.filter((r) => wrong.has(r.id));
  }

  // 셔플 후 limit (mulberry 없이 Fisher-Yates)
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const picked = rows.slice(0, limit);

  const questions = picked.map((r) => {
    const isTheory = Array.isArray(r.choices) && r.choices.length > 0;
    return isTheory
      ? // 이론: 정답·해설 숨김 (서버 채점)
        { id: r.id, type: "theory" as const, stem: r.stem, choices: r.choices, area: r.area, typeTag: r.type_tag }
      : // 실무: 자가채점이라 답·해설 포함
        {
          id: r.id,
          type: "practice" as const,
          stem: r.stem,
          answerText: r.answer_text,
          explanation: r.explanation,
          area: r.area,
          typeTag: r.type_tag,
        };
  });

  return NextResponse.json({ questions, total: rows.length });
}
