// 강사 알림 (디스코드 웹후크). DISCORD_WEBHOOK_URL 없으면 아무것도 안 한다.
// 호출부는 after()로 응답 뒤에 돌린다 — 알림 지연·실패가 학생 응답에 영향을 주면 안 된다.
import { rateLimit } from "./ratelimit";

// 수업 직후 질문이 몰리면 채널이 도배된다 — 분당 5건까지 보내고 나머지는 세었다가
// 다음 알림에 "+N건"으로 묶는다. (인메모리라 인스턴스별 — 폭주 방지 용도로는 충분)
const PER_MIN = 5;
let skipped = 0;

// 학생 이름은 성만 남긴다 — 웹후크 채널은 강사 외 사람이 볼 수도 있다
export function maskName(name?: string | null): string {
  const n = (name ?? "").trim();
  return n ? n[0] + "○".repeat(Math.max(1, n.length - 1)) : "학생";
}

export function clip(s: string, n = 80): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
}

// 알림에 DB 조회가 필요한 호출부가 웹후크 미설정 시 조회부터 건너뛰게
export const notifyEnabled = () => Boolean(process.env.DISCORD_WEBHOOK_URL);

export async function notify(text: string): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  if (!rateLimit("notify:discord", PER_MIN, 60_000)) {
    skipped++;
    return;
  }
  const extra = skipped ? `\n(그 사이 알림 ${skipped}건 더 있음)` : "";
  skipped = 0;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 학생이 쓴 글에 @everyone이 있어도 멘션이 터지지 않게
      body: JSON.stringify({ content: (text + extra).slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("notify:", e instanceof Error ? e.message : e);
  }
}
