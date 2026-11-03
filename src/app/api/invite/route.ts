import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { createInviteCode, parseInviteCode, inviteExpiresOn } from "@/lib/invite";

// 강사 학생-초대 정보: 코드, 링크, QR(SVG).
// GET            → 강사 전체 초대 (가입 시 기본반 등록)
// GET ?course=id → 강좌 ROOM 초대 (가입 시 그 ROOM에 바로 등록)
// GET ?from=코드&days=7|30 → 화면에 떠 있는 무기한 코드의 만료판 (InviteBox).
//   원장의 강사 초대(t)도 이 길로 — 원장 화면은 /api/admin에서 무기한 코드만 받는다.
export async function GET(req: Request) {
  const url_ = new URL(req.url);
  const courseParam = url_.searchParams.get("course");
  const fromParam = url_.searchParams.get("from");
  // 일 단위 고정값만 — 임의 기간을 받으면 코드 길이·안내 문구가 제각각이 된다
  const days = Number(url_.searchParams.get("days") ?? 0);
  if (![0, 7, 30].includes(days)) return NextResponse.json({ error: "days must be 0, 7, 30" }, { status: 400 });

  const from = fromParam ? parseInviteCode(fromParam) : null;
  if (fromParam && (!from || from.exp !== null))
    return NextResponse.json({ error: "유효하지 않은 초대 코드예요" }, { status: 400 });

  const kind = from?.kind ?? (courseParam ? "c" : "s");
  const gate = await requireRole(req, kind === "t" ? "admin" : "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  let code: string;
  if (kind === "c") {
    const courseId = from?.id ?? courseParam ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(courseId))
      return NextResponse.json({ error: "course required" }, { status: 400 });
    // 남의 강좌 코드를 발급받지 못하게 소유권 확인
    const { data: course } = await serviceClient()
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("teacher_id", uid)
      .maybeSingle();
    if (!course) return NextResponse.json({ error: "강좌를 찾을 수 없어요" }, { status: 404 });
    code = createInviteCode(course.id, "c", days);
  } else {
    // s·t는 발급자 본인 id — 남의 코드로 만료판을 찍어내지 못하게
    if (from && from.id !== uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    code = createInviteCode(uid, kind, days);
  }

  const url = `${url_.origin}/${kind === "t" ? "join-teacher" : "join"}/${code}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220 });

  return NextResponse.json({ code, url, qrSvg, expiresOn: inviteExpiresOn(code) });
}
