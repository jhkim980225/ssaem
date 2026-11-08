import { supabase } from "./supabase";
import type { Meta, Msg, Transport } from "./live";

// 실시간 수업 신호를 Supabase Realtime 채널(broadcast + presence)로 나른다.
// 채널 이름은 서버가 내려준 추측 불가 값(/api/live) — 공개 채널이라 이름이 곧 열쇠다.
export function supabaseTransport(
  channel: string,
  sid: string,
  onStatus: (s: "connected" | "error") => void
): Transport {
  const ch = supabase.channel(channel, {
    config: { broadcast: { self: false }, presence: { key: sid } },
  });
  const msgCbs: ((m: Msg) => void)[] = [];
  const presCbs: ((metas: Meta[]) => void)[] = [];
  let meta: Meta | null = null;
  let joined = false;
  let closing = false; // 서버가 닫은 것(속도 제한 등)과 내가 닫은 것을 가른다

  // Realtime은 클라이언트(채널)마다 Presence 갱신(track)을 30초에 5번까지만 받고, 넘으면 채널을 닫아 버린다
  // (ClientPresenceRateLimitReached). 잠금·해제 때 viewing·mode·away가 한꺼번에 바뀌어 넘쳤고, 닫힌 채널은
  // 다시 안 붙어 학생이 마지막 상태("수업 탭 떠남"·"잠김")로 굳은 채 명령도 못 받았다.
  // 그래서 바뀐 걸 0.3초 모아 한 번에 보내고, 30초에 4번을 넘기면 창이 빌 때까지 미룬다 (마지막 상태만 간다).
  const WINDOW = 30_000;
  const MAX = 4;
  const sent: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!joined || !meta) return;
    const now = Date.now();
    while (sent.length && now - sent[0] >= WINDOW) sent.shift();
    if (sent.length >= MAX) {
      timer = setTimeout(flush, sent[0] + WINDOW - now + 100);
      return;
    }
    sent.push(now);
    void ch.track(meta);
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 300);
  };

  ch.on("broadcast", { event: "m" }, ({ payload }) => {
    for (const cb of msgCbs) cb(payload as Msg);
  });
  ch.on("presence", { event: "sync" }, () => {
    // 같은 key(sid)로 여러 번 track하면 배열에 쌓일 수 있다 — 키마다 마지막 것만 쓴다
    const state = ch.presenceState<Meta>();
    const metas = Object.values(state)
      .map((arr) => arr[arr.length - 1])
      .filter(Boolean) as Meta[];
    for (const cb of presCbs) cb(metas);
  });
  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      joined = true;
      onStatus("connected");
      schedule();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || (status === "CLOSED" && !closing)) {
      joined = false;
      onStatus("error");
    }
  });

  return {
    send(m) {
      void ch.send({ type: "broadcast", event: "m", payload: m });
    },
    onMessage(cb) {
      msgCbs.push(cb);
    },
    track(m) {
      meta = m;
      if (joined) schedule();
    },
    onPresence(cb) {
      presCbs.push(cb);
    },
    close() {
      closing = true;
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    },
  };
}
