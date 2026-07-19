import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { teacherFromRequest } from "@/lib/auth";

// 내 자료 등록/제거 기록 (감사 로그)
export async function GET(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 30);
  const db = serviceClient();
  const { data, error } = await db
    .from("document_events")
    .select("id, action, title, kind, source, chunks, created_at")
    .eq("teacher_id", uid)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}
