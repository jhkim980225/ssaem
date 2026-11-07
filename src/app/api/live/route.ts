import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole } from "@/lib/auth";
import { channelFor, enrolledTeachers } from "@/lib/live-server";

export const runtime = "nodejs";

// 실시간 수업 입장 정보.
// - 강사: 내 수업방 채널 하나
// - 학생: 수강 연결된 선생님들의 수업방 (연결 안 된 강사의 방 이름은 절대 안 내준다)
export async function GET(req: Request) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 });
  if (me.role !== "teacher" && me.role !== "student")
    return NextResponse.json({ error: "강사·학생 계정만 쓸 수 있어요" }, { status: 403 });

  const db = serviceClient();
  const { data: profile } = await db.from("profiles").select("name").eq("id", me.uid).maybeSingle();
  const ids = me.role === "teacher" ? [me.uid] : await enrolledTeachers(db, me.uid);

  let rooms: { teacher: string; name: string; channel: string }[] = [];
  if (ids.length) {
    const { data } = await db.from("profiles").select("id, name").in("id", ids).eq("role", "teacher");
    rooms = (data ?? []).map((t) => ({ teacher: t.id, name: t.name ?? "선생님", channel: channelFor(t.id) }));
  }

  return NextResponse.json({
    me: { id: me.uid, name: profile?.name ?? "", role: me.role },
    rooms,
  });
}
