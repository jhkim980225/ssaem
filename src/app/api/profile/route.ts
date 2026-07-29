import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { teacherFromRequest } from "@/lib/auth";
import { resolveAcademy } from "@/lib/academy";

// 내 프로필 조회
export async function GET(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = serviceClient();
  const { data, error } = await db
    .from("profiles")
    .select("name, academy_id, role, teacher_profiles(subject, is_public)")
    .eq("id", uid)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ profile: null });

  const tp = Array.isArray(data.teacher_profiles) ? data.teacher_profiles[0] : data.teacher_profiles;
  return NextResponse.json({
    profile: {
      name: data.name,
      subject: tp?.subject ?? "",
      is_public: tp?.is_public ?? true,
    },
  });
}

// 프로필 저장 (강사)
export async function POST(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").toString().trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const subject = (body?.subject ?? "").toString().trim() || null;

  const db = serviceClient();
  const academyId = await resolveAcademy(db);

  const { error: perr } = await db
    .from("profiles")
    .upsert({ id: uid, academy_id: academyId, role: "teacher", name });
  if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });

  const { error: terr } = await db
    .from("teacher_profiles")
    .upsert({ id: uid, subject });
  if (terr) return NextResponse.json({ error: terr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
