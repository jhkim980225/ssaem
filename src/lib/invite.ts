import { createHmac } from "node:crypto";

// 초대 코드. DB 저장 없이 HMAC 서명으로 검증 (스키마 무변경).
// 코드 = kind + "." + base64url(uuid 16바이트) + "." + hmac 앞 8자.
// kind: s = 강사→학생 초대(id=강사), t = 원장→강사 초대(id=원장).
// ponytail: 발급자당 코드 고정(회전 불가) — 회전 필요해지면 버전 세그먼트 추가.
export type InviteKind = "s" | "t";

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
