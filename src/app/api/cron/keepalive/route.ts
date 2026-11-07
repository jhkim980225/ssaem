import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

// Supabase 무료 요금제는 일주일 동안 활동이 없으면 프로젝트를 일시정지한다
// (2026-11 실제로 멈춰 서비스 전체가 "없는 주소"가 됐다). 하루 한 번 가벼운 조회로 깨워 둔다.
// 호출: Vercel Cron (vercel.json). CRON_SECRET이 있으면 Vercel이 Bearer로 붙여 보낸다 — 그때만 통과.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { count, error } = await serviceClient()
    .from("academies")
    .select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, academies: count, at: new Date().toISOString() });
}
