import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { createInviteCode } from "@/lib/invite";

// 강사 학생-초대 정보: 코드, 링크, QR(SVG).
// GET            → 강사 전체 초대 (가입 시 기본반 등록)
// GET ?course=id → 강좌 ROOM 초대 (가입 시 그 ROOM에 바로 등록)
export async function GET(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  const url_ = new URL(req.url);
  const courseParam = url_.searchParams.get("course");

  let code: string;
  if (courseParam) {
    if (!/^[0-9a-f-]{36}$/i.test(courseParam))
      return NextResponse.json({ error: "course required" }, { status: 400 });
    // 남의 강좌 코드를 발급받지 못하게 소유권 확인
    const { data: course } = await serviceClient()
      .from("courses")
      .select("id")
      .eq("id", courseParam)
      .eq("teacher_id", uid)
      .maybeSingle();
    if (!course) return NextResponse.json({ error: "강좌를 찾을 수 없어요" }, { status: 404 });
    code = createInviteCode(course.id, "c");
  } else {
    code = createInviteCode(uid);
  }

  const url = `${url_.origin}/join/${code}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220 });

  return NextResponse.json({ code, url, qrSvg });
}
