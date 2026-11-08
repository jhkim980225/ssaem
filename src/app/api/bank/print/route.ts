import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { fetchAll } from "../../admin/_lib/fetch-all";

// 유형별 일괄 출력 — 한 급수의 문제를 유형(실무: 일반전표·매입매출전표·결산 / 이론: 영역)별로 전부, 정답·해설 포함.
// GET ?subject=전산세무2급&kind=practice&category=일반전표   (category 생략 = 실무 전 유형)
// GET ?subject=전산회계1급&kind=theory&area=재무회계         (area 생략 = 이론 전 영역)
// 정렬: 유형 → 최근 회차 → 회차 안 문항 번호. 열람(문제검색)과 같이 정답·해설을 함께 내린다.
const ORDER = ["일반전표", "매입매출전표", "결산"];
const roundOf = (s: string | null) => Number(/(\d+)\s*회/.exec(s ?? "")?.[1] ?? 0);

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankprint:${clientIp(req)}`, 10, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const url = new URL(req.url);
  const subject = (url.searchParams.get("subject") ?? "").trim().slice(0, 30);
  const kind = url.searchParams.get("kind") === "theory" ? "theory" : "practice";
  const category = (url.searchParams.get("category") ?? "").trim().slice(0, 20);
  const area = (url.searchParams.get("area") ?? "").trim().slice(0, 30);
  if (!subject) return NextResponse.json({ error: "급수를 골라 주세요." }, { status: 400 });

  const db = serviceClient();
  const { data, error } = await fetchAll((from, to) => {
    let q = db
      .from("bank_questions")
      .select("id, subject, category, type_tag, area, source, seq, stem, choices, answer_idx, answer_text, explanation, images")
      .eq("subject", subject);
    if (kind === "theory") {
      q = q.eq("category", "이론");
      if (area) q = q.eq("area", area);
    } else q = category && category !== "이론" ? q.eq("category", category) : q.neq("category", "이론");
    return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });

  type Row = {
    id: string;
    subject: string;
    category: string;
    type_tag: string;
    area: string;
    source: string | null;
    seq: number | null;
    stem: string;
    choices: string[] | null;
    answer_idx: number | null;
    answer_text: string | null;
    explanation: string | null;
    images?: string[] | null;
  };
  const group = (r: Row) => (kind === "theory" ? r.area : r.category);
  const rank = (gname: string) => (ORDER.includes(gname) ? ORDER.indexOf(gname) : 99);
  const rows = (data as Row[]).sort(
    (a, b) =>
      rank(group(a)) - rank(group(b)) ||
      group(a).localeCompare(group(b), "ko") ||
      roundOf(b.source) - roundOf(a.source) ||
      (a.seq ?? 999) - (b.seq ?? 999)
  );

  return NextResponse.json({
    subject,
    kind,
    questions: rows.map((r) => ({
      id: r.id,
      group: group(r),
      category: r.category,
      typeTag: r.type_tag,
      area: r.area,
      source: r.source,
      seq: r.seq,
      stem: r.stem,
      choices: r.choices,
      answerIdx: r.answer_idx,
      answerText: r.answer_text,
      explanation: r.explanation,
      images: r.images ?? null,
    })),
  });
}
