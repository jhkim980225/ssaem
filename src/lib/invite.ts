import { createHmac } from "node:crypto";
import type { serviceClient } from "./supabase";

// 초대 코드. DB 저장 없이 HMAC 서명으로 검증 (스키마 무변경).
// 코드 = kind + "." + base64url(uuid 16바이트) + "." + hmac 앞 8자.
// kind: s = 강사→학생 초대(id=강사), t = 원장→강사 초대(id=원장), c = 강좌 ROOM 초대(id=강좌).
// ponytail: 발급자당 코드 고정(회전 불가) — 회전 필요해지면 버전 세그먼트 추가.
export type InviteKind = "s" | "t" | "c";

const SECRET = () => process.env.INVITE_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sig(payload: string): string {
  return createHmac("sha256", SECRET()).update(payload).digest("base64url").slice(0, 8);
}

export function createInviteCode(id: string, kind: InviteKind = "s"): string {
  const raw = Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url"); // 22자
  return `${kind}.${raw}.${sig(kind + raw)}`;
}

export function verifyInviteCode(code: string, kind: InviteKind = "s"): string | null {
  const [k, raw, s] = code.split(".");
  if (k !== kind || !raw || !s || sig(k + raw) !== s) return null;
  const hex = Buffer.from(raw, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// 학생 초대 코드 해석 — 강사 코드(s)와 강좌 ROOM 코드(c)를 한 곳에서 처리.
// join/signup 양쪽이 쓰므로 여기 둔다 (각자 해석하면 c 코드 지원이 한쪽만 되는 사고가 난다).
export async function resolveStudentInvite(
  db: ReturnType<typeof serviceClient>,
  code: string
): Promise<{ teacherId: string; courseId: string | null; courseTitle: string | null } | null> {
  const teacherId = verifyInviteCode(code, "s");
  if (teacherId) return { teacherId, courseId: null, courseTitle: null };

  const courseId = verifyInviteCode(code, "c");
  if (!courseId) return null;
  const { data } = await db.from("courses").select("id, title, teacher_id").eq("id", courseId).maybeSingle();
  if (!data) return null; // 강좌가 지워졌으면 코드도 죽는다
  return { teacherId: data.teacher_id, courseId: data.id, courseTitle: data.title };
}
