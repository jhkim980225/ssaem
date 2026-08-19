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
    .select("name, academy_id, role, must_change_password, teacher_profiles(subject, is_public, tone_note)")
    .eq("id", uid)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ profile: null });

  const tp = Array.isArray(data.teacher_profiles) ? data.teacher_profiles[0] : data.teacher_profiles;
  return NextResponse.json({
    profile: {
      role: data.role, // 클라이언트 라우팅이 실제 역할을 알아야 함
      name: data.name,
      // 초기 비밀번호(휴대폰 뒷자리) 상태면 앱을 쓰기 전에 변경 화면을 띄운다
      mustChangePassword: data.must_change_password === true,
      subject: tp?.subject ?? "",
      is_public: tp?.is_public ?? true,
      tone_note: tp?.tone_note ?? "",
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
  const toneNote = (body?.tone_note ?? "").toString().trim().slice(0, 500) || null;
  const isPublic = body?.is_public === undefined ? true : Boolean(body.is_public);

  const db = serviceClient();
  // 이 라우트는 profiles.role을 'teacher'로 upsert한다 → 아무나 부르면 스스로 강사가 된다.
  // 허용: 이미 강사이거나, 프로필이 아직 없는 상태(강사 가입 직후 첫 저장)뿐.
  const { data: existing } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (existing && existing.role !== "teacher")
    return NextResponse.json(
      { error: existing.role === "admin" ? "원장 계정은 /admin에서 관리하세요" : "강사 계정만 쓸 수 있어요" },
      { status: 403 }
    );

  // 가입 시 초대/학원 링크 정보가 user_metadata에 있음 → 그 학원 소속 (id 우선, 다음 slug)
  const { data: au } = await db.auth.admin.getUserById(uid);
  const metaAcademyId = (au?.user?.user_metadata?.academy_id ?? null) as string | null;
  const slug = (au?.user?.user_metadata?.academy_slug ?? null) as string | null;
  const academyId = metaAcademyId ?? (await resolveAcademy(db, slug));

  const { error: perr } = await db
    .from("profiles")
    .upsert({ id: uid, academy_id: academyId, role: "teacher", name });
  if (perr) return NextResponse.json({ error: perr.message }, { status: 500 });

  const { error: terr } = await db
    .from("teacher_profiles")
    .upsert({ id: uid, subject, tone_note: toneNote, is_public: isPublic });
  if (terr) return NextResponse.json({ error: terr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
