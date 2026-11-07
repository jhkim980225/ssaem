import { createHmac, timingSafeEqual } from "node:crypto";
import type { serviceClient } from "./supabase";

// 실시간 수업(PC실 화면 공유·잠금) 서버 쪽.
//
// 신호(WebRTC offer/answer)와 명령은 Supabase Realtime 공개 broadcast 채널로 오간다.
// 공개 채널은 "이름을 아는 사람은 누구나 듣고 보낼 수 있다" — 그래서
//   1) 채널 이름은 강사 id를 서버 키로 HMAC한 값 (추측 불가, 수강 학생에게만 내려준다)
//   2) 잠금 같은 명령은 서버가 서명하고, 학생 화면은 받을 때마다 서버에 검증을 받는다.
//      채널 이름을 아는 학생이 강사 행세로 친구 PC를 잠그는 장난을 막는다.
// 별도 테이블·마이그레이션 없이 돌아가게 한 것 (스키마 변경은 수동 실행이라 배포가 무겁다).

type Db = ReturnType<typeof serviceClient>;

export type LiveAction = "lock" | "watch" | "unlock";
export type LiveCmd = {
  action: LiveAction;
  /** "all" 또는 학생 uid 목록 */
  targets: "all" | string[];
  teacher: string;
  ts: number;
  text?: string;
};

/** 명령 유효 시간. 학생 PC 시계가 틀려도 되게 서버 시각으로만 잰다. */
export const CMD_TTL_MS = 60_000;

function key(purpose: string): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY 없음");
  return createHmac("sha256", secret).update(`ssaem-live:${purpose}`).digest();
}

export function channelFor(teacherId: string): string {
  return "live-" + createHmac("sha256", key("room")).update(teacherId).digest("hex").slice(0, 32);
}

export function signCmd(cmd: LiveCmd): string {
  return createHmac("sha256", key("cmd")).update(JSON.stringify(cmd)).digest("base64url");
}

export function verifyCmd(cmd: LiveCmd, sig: string): boolean {
  const want = Buffer.from(signCmd(cmd));
  const got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** 학생이 수강 연결된 강사 id 전부 (/api/teachers와 같은 기준). */
export async function enrolledTeachers(db: Db, studentId: string): Promise<string[]> {
  const { data } = await db
    .from("enrollments")
    .select("courses!inner(teacher_id)")
    .eq("student_id", studentId);
  type Row = { courses: { teacher_id: string } | { teacher_id: string }[] };
  return [
    ...new Set(
      ((data ?? []) as Row[]).map((e) =>
        Array.isArray(e.courses) ? e.courses[0]?.teacher_id : e.courses?.teacher_id
      )
    ),
  ].filter(Boolean) as string[];
}
