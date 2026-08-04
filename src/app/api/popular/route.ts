import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { score } from "@/lib/lexical";

const SAMPLE = 400; // 최근 질문 표본
const CLUSTER_MIN = 10; // 이 점수 이상이면 같은 주제로 묶음 (lexical.ts 스케일 기준)

// 요즘 많이 묻는 질문 + 강사별 질문 비중.
// 임베딩 없는 messages라 lexical 그리디 클러스터링으로 주제 묶음.
export async function GET(req: Request) {
  const raw = (new URL(req.url).searchParams.get("teacher") ?? "").trim();
  const teacherId = /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;

  const db = serviceClient();
  let q = db
    .from("messages")
    .select("content, conversations!inner(teacher_id)")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(SAMPLE);
  if (teacherId) q = q.eq("conversations.teacher_id", teacherId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ questions: [], byTeacher: [] });

  type Row = { content: string; conversations: { teacher_id: string } | { teacher_id: string }[] };
  const rows = (data ?? []) as Row[];

  // 강사별 질문 수
  const perTeacher = new Map<string, number>();
  for (const r of rows) {
    const c = Array.isArray(r.conversations) ? r.conversations[0] : r.conversations;
    if (c?.teacher_id) perTeacher.set(c.teacher_id, (perTeacher.get(c.teacher_id) ?? 0) + 1);
  }

  // 주제 클러스터링 — 대표 질문은 클러스터 최초 등장(=가장 최근) 것
  const clusters: { text: string; count: number }[] = [];
  for (const r of rows) {
    const text = r.content.trim();
    if (text.length < 6) continue;
    const hit = clusters.find((c) => score(text, c.text) >= CLUSTER_MIN);
    if (hit) hit.count++;
    else clusters.push({ text: text.slice(0, 90), count: 1 });
  }
  // 2회 이상 반복된 주제만 노출 — 1회성 질문엔 개인 사정이 섞일 수 있어 공개 대상에서 제외
  const questions = clusters
    .filter((c) => c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 강사 이름 붙이기 (전체 모드에서만 의미 있음)
  const ids = [...perTeacher.keys()];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: ps } = await db.from("profiles").select("id, name").in("id", ids);
    for (const p of ps ?? []) names.set(p.id, p.name);
  }
  const total = rows.length || 1;
  const byTeacher = ids
    .map((id) => ({
      id,
      name: names.get(id) ?? "선생님",
      count: perTeacher.get(id) ?? 0,
      pct: Math.round(((perTeacher.get(id) ?? 0) / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return NextResponse.json({ questions, byTeacher, sampled: rows.length });
}
