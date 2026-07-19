import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";

// 공개 강사 목록. ?academy=<slug> 로 학원 한정.
// 학생 로그인 붙기 전까지는 slug 없으면 전체 공개 강사 반환 (단일 학원 배포 기준).
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("academy");
  const db = serviceClient();

  let academyId: string | null = null;
  if (slug) {
    const { data } = await db.from("academies").select("id").eq("slug", slug).maybeSingle();
    if (!data) return NextResponse.json({ teachers: [] });
    academyId = data.id;
  }

  let q = db
    .from("profiles")
    .select("id, name, academy_id, teacher_profiles!inner(subject, is_public)")
    .eq("role", "teacher")
    .eq("teacher_profiles.is_public", true)
    .order("name");
  if (academyId) q = q.eq("academy_id", academyId);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; name: string; teacher_profiles: { subject: string | null }[] | { subject: string | null } };
  const teachers = ((data ?? []) as Row[]).map((t) => ({
    id: t.id,
    name: t.name,
    subject: Array.isArray(t.teacher_profiles) ? t.teacher_profiles[0]?.subject ?? null : t.teacher_profiles?.subject ?? null,
  }));
  return NextResponse.json({ teachers });
}
