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
      if (meta) void ch.track(meta);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
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
      if (joined) void ch.track(m);
    },
    onPresence(cb) {
      presCbs.push(cb);
    },
    close() {
      void supabase.removeChannel(ch);
    },
  };
}
