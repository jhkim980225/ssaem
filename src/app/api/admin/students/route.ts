import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";

// 학생 제명 = 학원 연결 해제. 원장 전용, 자기 학원 학생만.
//   DELETE ?id=<uuid>
//
// 계정과 학습 기록(대화·응시·오답·서명·연락처 메모)은 지우지 않는다. 끊는 건 두 가지뿐:
//   1) profiles.academy_id → null : 학원 경계(sameAcademy)를 거치는 모든 라우트에서 빠진다
//   2) 우리 학원 강좌의 enrollments : 학생 화면 "내 선생님" 목록에서 빠진다
// 다른 학원 강좌 수강 연결은 건드리지 않는다.
export async function DELETE(req: Request) {
  const gate = await requireRole(req, "admin");
  if ("res" in gate) return gate.res;
  if (!rateLimit(`admin-expel:${gate.uid}`, 30, 3_600_000))
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });

  const studentId = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(studentId))
    return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = serviceClient();
  const academyId = await academyOf(db, gate.uid);
  if (!academyId) return NextResponse.json({ error: "학원 정보가 없어요" }, { status: 404 });

  // 학원·역할 조건을 update 자체에 건다 — 조회 후 갱신 사이에 소속이 바뀌어도 남의 학생은 못 건드린다
  const { data: hit, error } = await db
    .from("profiles")
    .update({ academy_id: null })
    .eq("id", studentId)
    .eq("academy_id", academyId)
    .eq("role", "student")
    .select("id");
  if (error) {
    console.error("admin expel:", error.message);
    return NextResponse.json({ error: "학생을 내보내지 못했어요." }, { status: 500 });
  }
  if (!hit?.length) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: courses } = await db.from("courses").select("id").eq("academy_id", academyId);
  const courseIds = (courses ?? []).map((c) => c.id);
  if (courseIds.length) {
    const { error: eerr } = await db
      .from("enrollments")
      .delete()
      .eq("student_id", studentId)
      .in("course_id", courseIds);
    // 소속은 이미 끊겼다 — 남은 수강 연결은 sameAcademy에서 막히므로 실패해도 접근은 안 열린다
    if (eerr) console.error("admin expel enrollments:", eerr.message);
  }

  return NextResponse.json({ ok: true });
}
