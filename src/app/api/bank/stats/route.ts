import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 기출 풀이 통계 — 정답률/오답률, 과목별·유형별 집계.
// GET            → 내 통계 (학생 마이페이지)
// GET ?name=김학생 → 같은 학원 사용자 통계 (강사가 이름으로 조회, 테넌트 경계 강제)
export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  if (!rateLimit(`bankstats:${clientIp(req)}`, 60, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const db = serviceClient();
  const name = (new URL(req.url).searchParams.get("name") ?? "").trim().slice(0, 30);

  let uid = g.uid;
  let displayName: string | null = null;
  if (name) {
    const academy = await academyOf(db, g.uid);
    if (!academy) return NextResponse.json({ stats: null });
    // 정확히 일치하는 이름 우선, 없으면 부분 일치 첫 사람
    const { data: users } = await db
      .from("profiles")
      .select("id, name")
      .eq("academy_id", academy)
      .ilike("name", `%${name}%`)
      .limit(10);
    const hit = (users ?? []).find((u) => u.name === name) ?? (users ?? [])[0];
    if (!hit) return NextResponse.json({ stats: null });
    uid = hit.id;
    displayName = hit.name;
  }

  const { data: attempts } = await db
    .from("bank_attempts")
    .select("question_id, is_correct")
    .eq("user_id", uid)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (!attempts?.length)
    return NextResponse.json({ stats: { name: displayName, totals: { attempts: 0, correct: 0, wrong: 0, rate: 0 }, bySubject: [], byTag: [] } });

  const qids = [...new Set(attempts.map((a) => a.question_id))];
  // .in()은 URL 길이 한도가 있어 500개씩 끊어 조회
  const meta = new Map<string, { subject: string; tag: string }>();
  for (let i = 0; i < qids.length; i += 500) {
    const { data: qs } = await db
      .from("bank_questions")
      .select("id, subject, type_tag")
      .in("id", qids.slice(i, i + 500));
    for (const q of qs ?? []) meta.set(q.id, { subject: q.subject, tag: q.type_tag });
  }

  let correct = 0;
  const bySubject = new Map<string, { attempts: number; correct: number }>();
  const byTag = new Map<string, { attempts: number; correct: number }>();
  for (const a of attempts) {
    if (a.is_correct) correct++;
    const m = meta.get(a.question_id);
    if (!m) continue;
    const s = bySubject.get(m.subject) ?? { attempts: 0, correct: 0 };
    s.attempts++;
    if (a.is_correct) s.correct++;
    bySubject.set(m.subject, s);
    const t = byTag.get(m.tag) ?? { attempts: 0, correct: 0 };
    t.attempts++;
    if (a.is_correct) t.correct++;
    byTag.set(m.tag, t);
  }
  const pct = (c: number, n: number) => (n ? Math.round((c / n) * 100) : 0);

  return NextResponse.json({
    stats: {
      name: displayName,
      totals: {
        attempts: attempts.length,
        correct,
        wrong: attempts.length - correct,
        rate: pct(correct, attempts.length),
      },
      bySubject: [...bySubject.entries()]
        .map(([subject, v]) => ({ subject, ...v, rate: pct(v.correct, v.attempts) }))
        .sort((a, b) => b.attempts - a.attempts),
      // 유형은 많이 푼 순 상위 12개 — 전부 깔면 차트가 길어져 안 읽힌다
      byTag: [...byTag.entries()]
        .map(([tag, v]) => ({ tag, ...v, rate: pct(v.correct, v.attempts) }))
        .sort((a, b) => b.attempts - a.attempts)
        .slice(0, 12),
    },
  });
}
