import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";

// 강사가 자기 학생의 비밀번호를 임시 비밀번호로 초기화한다.
// 아이디로 가입한 학생(<id>@ssaem.kr)은 재설정 메일을 받을 수 없어서, 잠기면 이 경로가 유일한 복구 수단이다.
// 임시 비밀번호는 응답에 한 번만 실려 나가고 저장하지 않는다 — 강사가 학생에게 직접 전달.
function tempPassword(): string {
  // 사람이 불러주기 쉬운 문자만 (0/O, 1/l 같은 혼동 문자 제외)
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join("");
}

export async function POST(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  // 계정 탈취 도구가 되지 않게 강사당 시간당 10회
  if (!rateLimit(`pwreset:${uid}`, 10, 3_600_000))
    return NextResponse.json({ error: "초기화 요청이 너무 잦아요. 잠시 후 다시 해주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const studentId = (body?.studentId ?? "").toString();
  if (!/^[0-9a-f-]{36}$/i.test(studentId))
    return NextResponse.json({ error: "studentId required" }, { status: 400 });

  const db = serviceClient();

  // 같은 학원 학생인지 먼저 확인 — 다른 학원 학생 계정을 건드리지 못하게
  const [{ data: me }, { data: profile }] = await Promise.all([
    db.from("profiles").select("academy_id").eq("id", uid).maybeSingle(),
    db.from("profiles").select("name, role, academy_id").eq("id", studentId).maybeSingle(),
  ]);
  if (!profile || profile.role !== "student")
    return NextResponse.json({ error: "학생 계정이 아니에요" }, { status: 403 });
  if (!me?.academy_id || profile.academy_id !== me.academy_id)
    return NextResponse.json({ error: "우리 학원 학생이 아니에요" }, { status: 403 });

  // "내 학생" = 내 강좌 수강생 이거나 나에게 질문한 적이 있는 학생.
  // 학생별 리포트가 질문 기준으로 뜨므로, 거기 보이는 학생은 초기화도 돼야 한다.
  const [{ count: enrolled }, { count: asked }] = await Promise.all([
    db
      .from("enrollments")
      .select("id, courses!inner(teacher_id)", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("courses.teacher_id", uid),
    db
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .eq("teacher_id", uid),
  ]);
  if (!(enrolled ?? 0) && !(asked ?? 0))
    return NextResponse.json({ error: "내 학생이 아니에요" }, { status: 403 });

  const password = tempPassword();
  const { error } = await db.auth.admin.updateUserById(studentId, { password });
  if (error) {
    console.error("student pw reset:", error.message);
    return NextResponse.json({ error: "초기화하지 못했어요. 잠시 후 다시 해주세요." }, { status: 500 });
  }

  // 학생이 어떤 아이디로 로그인하는지도 같이 알려준다 (강사가 전달해야 하므로)
  const { data: au } = await db.auth.admin.getUserById(studentId);
  const email = au?.user?.email ?? "";
  const loginId = email.endsWith("@ssaem.kr") ? email.replace(/@ssaem\.kr$/, "") : email;

  return NextResponse.json({ ok: true, name: profile.name, loginId, password });
}
