import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { serviceClient } from "@/lib/supabase";
import { CMD_TTL_MS, enrolledTeachers, verifyCmd, type LiveCmd } from "@/lib/live-server";

export const runtime = "nodejs";

// 학생 화면이 채널에서 받은 명령을 따르기 전에 확인한다.
// 서명 + 유효 시간 + "내 선생님의 명령인가" + "나한테 온 명령인가"를 모두 본다.
export async function POST(req: Request) {
  const g = await requireRole(req, "student");
  if ("res" in g) return g.res;

  const body = await req.json().catch(() => null);
  const cmd = body?.cmd as LiveCmd | undefined;
  const sig = body?.sig;
  if (!cmd || typeof sig !== "string" || !verifyCmd(cmd, sig))
    return NextResponse.json({ ok: false, error: "서명이 맞지 않아요" }, { status: 400 });
  if (Math.abs(Date.now() - cmd.ts) > CMD_TTL_MS)
    return NextResponse.json({ ok: false, error: "만료된 명령이에요" }, { status: 400 });
  if (cmd.targets !== "all" && !cmd.targets.includes(g.uid))
    return NextResponse.json({ ok: false, error: "나에게 온 명령이 아니에요" }, { status: 400 });

  const mine = await enrolledTeachers(serviceClient(), g.uid);
  if (!mine.includes(cmd.teacher))
    return NextResponse.json({ ok: false, error: "수강 중인 선생님이 아니에요" }, { status: 403 });

  return NextResponse.json({ ok: true });
}
