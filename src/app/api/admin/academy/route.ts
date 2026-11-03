import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireRole } from "@/lib/auth";
import { academyOf } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";

const MAX_NAME = 40;

// 학원명 수정 — 원장 전용, 자기 학원만.
// slug는 바꾸지 않는다: 가입(signup)이 academy_slug로 학원을 찾고 없으면 **새로 만든다**(resolveAcademy).
// 옛 /a/<slug> 링크로 가입하면 이름이 slug인 유령 학원에 소속돼 버린다.
export async function PATCH(req: Request) {
  const gate = await requireRole(req, "admin");
  if ("res" in gate) return gate.res;
  if (!rateLimit(`admin-academy:${gate.uid}`, 10, 3_600_000))
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").toString().trim().replace(/\s+/g, " ");
  if (!name) return NextResponse.json({ error: "학원 이름을 입력해 주세요." }, { status: 400 });
  if (name.length > MAX_NAME)
    return NextResponse.json({ error: `학원 이름은 ${MAX_NAME}자 이하로 해 주세요.` }, { status: 400 });

  const db = serviceClient();
  const academyId = await academyOf(db, gate.uid);
  if (!academyId) return NextResponse.json({ error: "학원 정보가 없어요" }, { status: 404 });

  const { error } = await db.from("academies").update({ name }).eq("id", academyId);
  if (error) {
    console.error("admin academy rename:", error.message);
    return NextResponse.json({ error: "학원 이름을 바꾸지 못했어요." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, name });
}
