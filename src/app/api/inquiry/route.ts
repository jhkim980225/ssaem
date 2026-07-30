import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 도입 문의 (공개). 조회는 운영자가 Supabase 대시보드에서 — UI 없음 (docs/수익화-플랜.md).
export async function POST(req: Request) {
  if (!rateLimit(`inquiry:${clientIp(req)}`, 3, 60_000))
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").toString().trim().slice(0, 50);
  const contact = (body?.contact ?? "").toString().trim().slice(0, 100);
  const message = (body?.message ?? "").toString().trim().slice(0, 1000) || null;
  const academySlug = (body?.academySlug ?? "").toString().trim().slice(0, 50) || null;
  if (!name || !contact)
    return NextResponse.json({ error: "이름과 연락처를 입력해 주세요." }, { status: 400 });

  const { error } = await serviceClient()
    .from("plan_inquiries")
    .insert({ name, contact, message, academy_slug: academySlug });
  if (error) {
    console.error("inquiry:", error.message);
    return NextResponse.json({ error: "접수에 실패했어요. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
