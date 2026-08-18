import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser, userWithRole } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";

// 학생 상세정보 (연락처·강사 메모). 개인정보라 접근을 좁게 잡는다.
//
//   GET  ?student=<uuid>   강사·원장 — 같은 학원 학생만
//   POST { studentId, phone, note }  강사·원장 — 같은 학원 학생만
//
// 학생 본인은 이 라우트를 쓰지 않는다 (입력·열람 주체는 강사·원장으로 정함).
// profiles와 분리된 student_details 테이블을 쓰는 이유는 스키마 주석 참조.

const MAX_PHONE = 30;
const MAX_NOTE = 500;

/** 대상 학생이 호출자와 같은 학원인지. 아니면 접근 불가. */
async function sameAcademyStudent(
  db: ReturnType<typeof serviceClient>,
  uid: string,
  studentId: string
): Promise<boolean> {
  const mine = await academyOf(db, uid);
  if (!mine) return false;
  const { data } = await db
    .from("profiles")
    .select("academy_id, role")
    .eq("id", studentId)
    .maybeSingle();
  return data?.role === "student" && Boolean(data.academy_id) && data.academy_id === mine;
}

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const me = await userWithRole(req);
  if (me?.role !== "teacher" && me?.role !== "admin")
    return NextResponse.json({ error: "강사·원장만 볼 수 있어요." }, { status: 403 });

  const studentId = (new URL(req.url).searchParams.get("student") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(studentId))
    return NextResponse.json({ error: "student required" }, { status: 400 });

  const db = serviceClient();
  if (!(await sameAcademyStudent(db, g.uid, studentId)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data } = await db
    .from("student_details")
    .select("phone, note, updated_at")
    .eq("student_id", studentId)
    .maybeSingle();
  return NextResponse.json({
    detail: { phone: data?.phone ?? "", note: data?.note ?? "", updatedAt: data?.updated_at ?? null },
  });
}

export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  const me = await userWithRole(req);
  if (me?.role !== "teacher" && me?.role !== "admin")
    return NextResponse.json({ error: "강사·원장만 수정할 수 있어요." }, { status: 403 });

  if (!rateLimit(`sdetail:${g.uid}`, 60, 60_000))
    return NextResponse.json({ error: "요청이 너무 잦아요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const studentId = (body?.studentId ?? "").toString();
  if (!/^[0-9a-f-]{36}$/i.test(studentId))
    return NextResponse.json({ error: "studentId required" }, { status: 400 });

  // 빈 문자열은 "지움"으로 본다 (null 저장)
  const phone = (body?.phone ?? "").toString().trim().slice(0, MAX_PHONE) || null;
  const note = (body?.note ?? "").toString().trim().slice(0, MAX_NOTE) || null;

  const db = serviceClient();
  if (!(await sameAcademyStudent(db, g.uid, studentId)))
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { error } = await db.from("student_details").upsert(
    {
      student_id: studentId,
      phone,
      note,
      updated_by: g.uid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "student_id" }
  );
  if (error) {
    console.error("student_details upsert:", error.message);
    return NextResponse.json({ error: "저장하지 못했어요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
