import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { usageFor } from "@/lib/plan";

// 대시보드 사용량. 강사는 본인 자료 수 + 학원 오늘 질문 수, 원장은 학원 질문 수.
// 한도 초과를 "버튼 눌러 실패해야 아는" 상태를 없애려고 만든 읽기 전용 엔드포인트.
export async function GET(req: Request) {
  const gate = await requireUser(req);
  if ("res" in gate) return gate.res;

  const db = serviceClient();
  const { data: me } = await db
    .from("profiles")
    .select("role, academy_id")
    .eq("id", gate.uid)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "프로필이 없어요" }, { status: 404 });

  const usage = await usageFor(db, {
    academyId: me.academy_id,
    // 자료 한도는 강사 본인 기준. 원장은 학원 질문 한도만 본다.
    teacherId: me.role === "teacher" ? gate.uid : undefined,
  });
  return NextResponse.json(usage);
}
