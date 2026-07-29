import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { userFromRequest } from "@/lib/auth";
import { createInviteCode } from "@/lib/invite";

// 강사 학생-초대 정보: 코드, 링크, QR(SVG).
export async function GET(req: Request) {
  const uid = await userFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const code = createInviteCode(uid);
  const origin = new URL(req.url).origin;
  const url = `${origin}/join/${code}`;
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220 });

  return NextResponse.json({ code, url, qrSvg });
}
