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

  type Row = {
    id: string;
    stem: string;
    category: string;
    choices: string[] | null;
    answer_idx: number | null;
    answer_text: string | null;
    explanation: string | null;
    area: string;
    type_tag: string;
  };

  // 문제 세트 — 후보 id를 **전부** 모은 뒤 셔플·추출하고 본문은 그때 가져온다.
  // 예전엔 필터 결과의 임의 400건만 받아서 두 가지가 깨졌다:
  //   ① 400문항 초과 과목(전 과목 644~719문항)은 고정된 일부만 출제됐고
  //   ② mode=wrong이 그 400 안에 없는 오답을 놓쳐 오답노트 재풀이가 불완전했다.
  const filteredIds = () => {
    let q = db.from("bank_questions").select("id");
    if (subject) q = q.eq("subject", subject);
    if (category) q = q.eq("category", category);
    if (area) q = q.eq("area", area);
    if (typeTag) q = q.eq("type_tag", typeTag);
    return q;
  };
  let ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    // PostgREST 1000행 캡 우회 — 과목 전체(2035)를 볼 수도 있으므로 페이지네이션
    const { data, error } = await filteredIds().range(from, from + 999);
    if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });
    if (!data?.length) break;
    ids.push(...data.map((r) => r.id));
    if (data.length < 1000) break;
  }

  if (mode === "wrong") {
    const wrong = await lastWrongBankIds(db, g.uid);
    ids = ids.filter((id) => wrong.has(id));
  }

  // 셔플 후 limit (Fisher-Yates)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const total = ids.length;
  const pickedIds = ids.slice(0, limit);
  if (!pickedIds.length) return NextResponse.json({ questions: [], total: 0 });

  const { data: rowData, error } = await db
    .from("bank_questions")
    // answer_idx는 isTheory 판별에만 쓰고 응답엔 넣지 않는다 (이론 정답 미노출 유지)
    .select("id, stem, category, choices, answer_idx, answer_text, explanation, area, type_tag")
    .in("id", pickedIds);
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });
  // .in()은 순서를 보장하지 않으니 셔플 순서대로 재정렬
  const byId = new Map(((rowData ?? []) as Row[]).map((r) => [r.id, r]));
  const picked = pickedIds.map((id) => byId.get(id)).filter(Boolean) as Row[];

  const questions = picked.map((r) => {
    // POST(채점)의 판별과 동일하게 answer_idx까지 확인 — choices는 있는데 answer_idx가 없는
    // 문항을 이론으로 내보내면 채점 POST가 self-grade를 기대해 400으로 막힌다.
    const isTheory = Array.isArray(r.choices) && r.choices.length > 0 && r.answer_idx !== null;
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

  return NextResponse.json({ questions, total });
}
