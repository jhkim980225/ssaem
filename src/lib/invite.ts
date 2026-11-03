import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import type { serviceClient } from "./supabase";

// 초대 코드. DB 저장 없이 HMAC 서명으로 검증 (스키마 무변경).
// 코드 = kind + "." + base64url(uuid 16바이트) + "." + hmac 앞 8자.          ← 무기한 (기존 형식)
// 만료형 = kind + "." + base64url(uuid) + "." + 만료일(base36) + "." + hmac 앞 8자.
// kind: s = 강사→학생 초대(id=강사), t = 원장→강사 초대(id=원장), c = 강좌 ROOM 초대(id=강좌).
// 만료일은 KST 일수(1970-01-01 기준)를 base36으로 — 3자라 QR 밀도가 거의 안 늘어난다.
// 무기한 코드는 계속 유효해야 한다 (이미 인쇄·배포된 QR). 그래서 토막 수로 형식을 구분한다.
// ponytail: 발급자당 무기한 코드는 고정(회전 불가) — 회전은 DB에 발급자별 버전이 있어야 한다.
export type InviteKind = "s" | "t" | "c";

const SECRET = () => process.env.INVITE_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DAY = 86_400_000;
// KST 기준 오늘 — "7일"이 한국 날짜로 끊기게
const today = () => Math.floor((Date.now() + 9 * 3_600_000) / DAY);

function sig(payload: string): string {
  return createHmac("sha256", SECRET()).update(payload).digest("base64url").slice(0, 8);
}

export function createInviteCode(id: string, kind: InviteKind = "s", days = 0): string {
  const raw = Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url"); // 22자
  if (!days) return `${kind}.${raw}.${sig(kind + raw)}`;
  const exp = (today() + days).toString(36);
  // 서명 대상에 "."을 끼워 무기한 형식과 섞이지 않게 (raw는 base64url이라 "."이 없다)
  return `${kind}.${raw}.${exp}.${sig(`${kind}${raw}.${exp}`)}`;
}

// 서명만 검증하고 만료는 판단하지 않는다 — 만료 여부는 exp로 호출부가 본다.
export function parseInviteCode(code: string): { kind: InviteKind; id: string; exp: number | null } | null {
  const parts = code.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [k, raw] = parts;
  const s = parts[parts.length - 1];
  const e = parts.length === 4 ? parts[2] : null;
  if (k !== "s" && k !== "t" && k !== "c") return null;
  if (!raw || !s || (e !== null && !/^[0-9a-z]{1,6}$/.test(e))) return null;
  if (sig(e === null ? k + raw : `${k}${raw}.${e}`) !== s) return null;
  const hex = Buffer.from(raw, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { kind: k, id, exp: e === null ? null : parseInt(e, 36) };
}

const expired = (exp: number | null) => exp !== null && today() > exp;

export function verifyInviteCode(code: string, kind: InviteKind = "s"): string | null {
  const p = parseInviteCode(code);
  if (!p || p.kind !== kind || expired(p.exp)) return null;
  return p.id;
}

// 서명은 맞는데 날짜가 지난 코드 — "잘못된 코드"와 따로 안내해야 새 링크를 받으러 간다
export function inviteExpired(code: string): boolean {
  const p = parseInviteCode(code);
  return !!p && expired(p.exp);
}

// 만료일(마지막으로 쓸 수 있는 날, KST) "YYYY-MM-DD" — 화면 안내용
export function inviteExpiresOn(code: string): string | null {
  const p = parseInviteCode(code);
  return p?.exp == null ? null : new Date(p.exp * DAY).toISOString().slice(0, 10);
}

export function expiredInviteRes(who = "선생님") {
  return NextResponse.json(
    { error: `링크가 만료됐어요 — ${who}께 새 링크를 받으세요`, expired: true },
    { status: 410 }
  );
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
