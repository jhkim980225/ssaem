import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 문제모음 검색: 키워드 → 지문 또는 보기에 키워드가 포함된 문제 전부 (정답·해설 포함, 열람용).
// GET ?q=재무&kind=theory|practice&subject=전산회계2급&area=부가가치세
//   kind=theory  → 이론(4지선다)만
//   kind=practice → 실무(일반전표·매입매출전표·결산 — 이론이 아닌 전부)
//   subject 생략 → 전 급수 통합 검색 (결과 행에 subject가 실려 태그로 표시)
//   area 생략 → 전 영역. 주면 그 영역(재무회계·원가회계·부가가치세·소득세·법인세)만
//   part → 영역 안의 세부 파트(소득세: 근로소득·소득공제·세액공제 등). 생략하면 그 영역 전부
//   category → kind=practice일 때 그 유형(일반전표·매입매출전표·결산)만. 생략하면 실무 전부
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`banksearch:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const subject = (url.searchParams.get("subject") ?? "").trim().slice(0, 30);
  const area = (url.searchParams.get("area") ?? "").trim().slice(0, 30);
  const part = (url.searchParams.get("part") ?? "").trim().slice(0, 40);
  const category = (url.searchParams.get("category") ?? "").trim().slice(0, 20);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
  const kindParam = url.searchParams.get("kind");
  const kind = kindParam === "practice" ? "practice" : kindParam === "theory" ? "theory" : "";
  if (q.length < 2)
    return NextResponse.json({ error: "두 글자 이상 검색어가 필요해요" }, { status: 400 });

  const db = serviceClient();
  // ilike 특수문자(%, _)는 그대로 두면 와일드카드로 동작 — 이스케이프
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  // search_text = 지문 + 보기, 글 속 그림 URL 제외 (마이그레이션 20261008000000).
  // 컴활 2과목은 함수가 보기에만 나오는 문항이 많아 지문만 보면 "VLOOKUP"이 1건뿐이었다
  const run = (col: "search_text" | "stem") => {
    let qb = db
      .from("bank_questions")
      .select(
        "id, subject, category, type_tag, area, source, stem, choices, answer_idx, answer_text, explanation, images",
        { count: "exact" }
      )
      .ilike(col, like);
    if (subject) qb = qb.eq("subject", subject);
    if (area) qb = qb.eq("area", area);
    if (part) qb = qb.eq("part", part);
    if (kind === "theory") qb = qb.eq("category", "이론");
    // 실무 유형을 주면 그 유형만 — "이론"을 넣어 실무 탭에서 이론이 새지 않게 막는다
    if (kind === "practice")
      qb = category && category !== "이론" ? qb.eq("category", category) : qb.neq("category", "이론");
    return qb.order("source", { ascending: false }).limit(100);
  };
  let { data, error, count } = await run("search_text");
  // 마이그레이션 전 DB(열 없음, 42703)에선 예전처럼 지문만
  if (error?.code === "42703" || /search_text/.test(error?.message ?? "")) ({ data, error, count } = await run("stem"));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const questions = (data ?? []).map((r) => ({
    id: r.id,
    subject: r.subject,
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
