import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userFromRequest } from "@/lib/auth";

// 강좌 관리.
// GET ?teacher=<id> → 공개용: 그 강사의 강좌 목록 (학생 필터 칩)
// GET (인증)       → 내 강좌 목록 (자료 수 포함)
// POST {title}     → 강좌 생성
// DELETE ?id=      → 강좌 삭제 (자료는 course_id null로 남음 — 공용 전환)
export async function GET(req: Request) {
  const db = serviceClient();
  const teacherParam = new URL(req.url).searchParams.get("teacher");

  if (teacherParam) {
    const { data, error } = await db
      .from("courses")
      .select("id, title")
      .eq("teacher_id", teacherParam)
      .order("created_at");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ courses: data ?? [] });
  }

  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await db
    .from("courses")
    .select("id, title, created_at, documents(count)")
    .eq("teacher_id", uid)
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; title: string; created_at: string; documents: { count: number }[] };
  const courses = ((data ?? []) as Row[]).map((c) => ({
    id: c.id,
    title: c.title,
    created_at: c.created_at,
    documents: c.documents?.[0]?.count ?? 0,
  }));
  return NextResponse.json({ courses });
}

export async function POST(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = (body?.title ?? "").toString().trim().slice(0, 100);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const db = serviceClient();
  const { data: me } = await db.from("profiles").select("academy_id").eq("id", uid).maybeSingle();
  if (!me?.academy_id)
    return NextResponse.json({ error: "프로필을 먼저 저장하세요" }, { status: 400 });

  const { data, error } = await db
    .from("courses")
    .insert({ academy_id: me.academy_id, teacher_id: uid, title })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = serviceClient();
  const { error } = await db.from("courses").delete().eq("id", id).eq("teacher_id", uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
