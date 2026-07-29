import { createHmac } from "node:crypto";

// 강사 학생-초대 코드. DB 저장 없이 HMAC 서명으로 검증 (스키마 무변경).
// 코드 = base64url(teacherId uuid 16바이트) + "." + hmac 앞 8자.
// ponytail: 강사당 코드 고정(회전 불가) — 회전 필요해지면 코드에 버전 넣고 teacher_profiles에 버전 컬럼.
const SECRET = () => process.env.INVITE_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sig(payload: string): string {
  return createHmac("sha256", SECRET()).update(payload).digest("base64url").slice(0, 8);
}

export function createInviteCode(teacherId: string): string {
  const raw = Buffer.from(teacherId.replace(/-/g, ""), "hex").toString("base64url"); // 22자
  return `${raw}.${sig(raw)}`;
}

export function verifyInviteCode(code: string): string | null {
  const [raw, s] = code.split(".");
  if (!raw || !s || sig(raw) !== s) return null;
  const hex = Buffer.from(raw, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
