import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { signCmd, type LiveAction, type LiveCmd } from "@/lib/live-server";

export const runtime = "nodejs";

const ACTIONS: LiveAction[] = ["lock", "watch", "unlock"];

// 강사가 잠금·보기 모드·해제 명령에 서버 서명을 받는다. 강사 화면은 받은 {cmd, sig}를
// 수업방 채널에 그대로 뿌리고, 학생 화면은 /api/live/verify로 확인한 뒤에만 따른다.
export async function POST(req: Request) {
  const g = await requireRole(req, "teacher");
  if ("res" in g) return g.res;

  const body = await req.json().catch(() => null);
  const action = body?.action as LiveAction;
  if (!ACTIONS.includes(action)) return NextResponse.json({ error: "알 수 없는 명령이에요" }, { status: 400 });

  let targets: LiveCmd["targets"] = "all";
  if (Array.isArray(body?.targets)) {
    targets = (body.targets as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 200);
    if (!targets.length) return NextResponse.json({ error: "대상 학생이 없어요" }, { status: 400 });
  }
  const text = typeof body?.text === "string" ? body.text.slice(0, 200) : undefined;

  const cmd: LiveCmd = { action, targets, teacher: g.uid, ts: Date.now(), ...(text ? { text } : {}) };
  return NextResponse.json({ cmd, sig: signCmd(cmd) });
}
