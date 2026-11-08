// 실시간 수업 — 브라우저 쪽 핵심 (화면 전송 WebRTC + 잠금 프로그램 연결).
//
// 구조: 강사 PC가 화면을 잡아(getDisplayMedia) 학생마다 RTCPeerConnection을 하나씩 연다
// (메시 방식). PC실 내부망이라 영상은 공유기 안에서 PC끼리 직접 오가고, 서버를 지나는 건
// 연결 신호(offer/answer/ICE)뿐이다. 20대 안팎까지는 강사 PC 한 대로 버틴다 — 그 이상이면
// 중계 서버(SFU)를 붙일 자리가 Transport 뒤쪽이다.
//
// 신호 전달은 Transport 인터페이스로 감쌌다. 실서비스는 Supabase Realtime(live-supabase.ts),
// 검사 스크립트는 BroadcastChannel을 꽂아 같은 코드를 그대로 돌린다.

export type LiveRole = "teacher" | "student";
export type AgentMode = "none" | "lock" | "watch";

/** Presence에 싣는 내 상태. 강사 화면의 학생 목록이 이걸로 그려진다. */
export type Meta = {
  sid: string; // 탭마다 새로 뽑는 세션 id (같은 학생이 탭 두 개면 둘 다 보인다)
  role: LiveRole;
  uid: string;
  name: string;
  /** 학생: 화면을 받고 있는지 */
  viewing?: boolean;
  /** 학생: 수업 탭을 떠났는지 (다른 창·최소화) */
  away?: boolean;
  /** 학생: 이 PC에 잠금 프로그램이 돌고 있는지 */
  agent?: boolean;
  /** 학생: 잠금 프로그램 버전 (1.2부터 잠금 해제 때 포커스를 돌려주고 보기 때 수업 탭을 앞으로) */
  agentV?: string;
  /** 학생: 지금 걸린 모드 */
  mode?: AgentMode;
  /** 강사: 화면 공유 중인지 */
  sharing?: boolean;
};

/** 채널로 오가는 메시지 하나. to가 없으면 전체. */
export type Msg =
  | { t: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: "ice"; from: string; to: string; c: RTCIceCandidateInit }
  | { t: "ended"; from: string }
  | { t: "cmd"; from: string; cmd: SignedCmd["cmd"]; sig: string }
  // 학생 → 강사 감독 연결 (학생 화면 미리보기·지금 쓰는 프로그램). 화면 공유와 따로 연다.
  | { t: "moffer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: "manswer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { t: "mice"; from: string; to: string; c: RTCIceCandidateInit };

/** 학생 PC 맨 앞 창 (잠금 프로그램이 알려준다). app=null이면 잠금 프로그램이 없어 모른다. */
export type Activity = { app: string | null; title: string; at: number };

/** 강사가 보는 학생 한 명의 감독 정보. shot/big은 blob URL. */
export type Watch = { activity?: Activity; shot?: string; big?: string };

// 감독 연결로 보내는 그림의 첫 바이트 (작은 미리보기 / 크게 보기)
const SHOT_THUMB = 1;
const SHOT_BIG = 2;

export type SignedCmd = {
  cmd: { action: "lock" | "watch" | "unlock"; targets: "all" | string[]; teacher: string; ts: number; text?: string };
  sig: string;
};

export interface Transport {
  send(m: Msg): void;
  onMessage(cb: (m: Msg) => void): void;
  track(meta: Meta): void;
  onPresence(cb: (metas: Meta[]) => void): void;
  close(): void;
}

export function newSid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// 내부망 PC끼리는 호스트 후보만으로 붙는다. STUN은 망이 나뉜 학원(층별 공유기 등) 대비 보험.
const RTC: RTCConfiguration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// 화면 글씨가 뭉개지지 않게 해상도를 지키고 프레임을 낮춘다 (엑셀·KcLep 화면은 거의 정지 화면).
const SEND: RTCRtpEncodingParameters = { maxBitrate: 2_500_000, maxFramerate: 15 };

/** 원격 설명이 붙기 전에 도착한 ICE 후보를 모아뒀다가 붙인 뒤 넣는다. */
class Peer {
  pc: RTCPeerConnection;
  private pending: RTCIceCandidateInit[] = [];
  constructor() {
    this.pc = new RTCPeerConnection(RTC);
  }
  async remote(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(sdp);
    for (const c of this.pending.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
  }
  async ice(c: RTCIceCandidateInit) {
    if (this.pc.remoteDescription) await this.pc.addIceCandidate(c).catch(() => {});
    else this.pending.push(c);
  }
  close() {
    this.pc.onicecandidate = null;
    this.pc.onconnectionstatechange = null;
    this.pc.ontrack = null;
    this.pc.close();
  }
}

// ───────────────────────── 강사 ─────────────────────────

export class TeacherLive {
  students: Meta[] = [];
  stream: MediaStream | null = null;
  /** 학생 sid → 감독 정보 */
  watch = new Map<string, Watch>();
  private peers = new Map<string, Peer>();
  private monitors = new Map<string, { peer: Peer; dc?: RTCDataChannel }>();
  private me: Meta;

  constructor(
    private t: Transport,
    me: Omit<Meta, "role">,
    private onChange: () => void
  ) {
    this.me = { ...me, role: "teacher", sharing: false };
    t.onMessage((m) => this.onMsg(m));
    t.onPresence((metas) => this.onPresence(metas));
    t.track(this.me);
  }

  get sid() {
    return this.me.sid;
  }

  /** 화면 공유 시작. 테스트에선 캔버스 스트림을 넘긴다. */
  share(stream: MediaStream) {
    this.closePeers();
    this.stream = stream;
    for (const tr of stream.getVideoTracks()) {
      tr.contentHint = "detail";
      // 브라우저의 "공유 중지" 버튼으로 끊어도 학생 쪽이 정리되게
      tr.addEventListener("ended", () => this.stop());
    }
    this.me = { ...this.me, sharing: true };
    this.t.track(this.me);
    for (const s of this.students) void this.offer(s.sid);
    this.onChange();
  }

  stop() {
    if (!this.stream) return;
    for (const tr of this.stream.getTracks()) tr.stop();
    this.stream = null;
    this.closePeers();
    this.t.send({ t: "ended", from: this.sid });
    this.me = { ...this.me, sharing: false };
    this.t.track(this.me);
    this.onChange();
  }

  /** 서버 서명을 받은 명령을 채널에 뿌린다. */
  command(signed: SignedCmd) {
    this.t.send({ t: "cmd", from: this.sid, cmd: signed.cmd, sig: signed.sig });
  }

  /** 학생별 연결 상태 (new/connecting/connected/failed…) */
  stateOf(sid: string): RTCPeerConnectionState | "none" {
    return this.peers.get(sid)?.pc.connectionState ?? "none";
  }

  /** 학생 화면을 크게 한 장 요청한다 (도착하면 watch.get(sid).big) */
  requestBig(sid: string) {
    const dc = this.monitors.get(sid)?.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify({ k: "want" }));
  }

  close() {
    this.stop();
    for (const sid of [...this.monitors.keys()]) this.dropMonitor(sid);
    this.t.close();
  }

  private onPresence(metas: Meta[]) {
    this.students = metas.filter((m) => m.role === "student");
    const here = new Set(this.students.map((s) => s.sid));
    for (const [sid, p] of this.peers)
      if (!here.has(sid)) {
        p.close();
        this.peers.delete(sid);
      }
    for (const sid of [...this.monitors.keys()]) if (!here.has(sid)) this.dropMonitor(sid);
    if (this.stream) for (const s of this.students) if (!this.peers.has(s.sid)) void this.offer(s.sid);
    this.onChange();
  }

  private async offer(to: string) {
    const stream = this.stream;
    if (!stream) return;
    this.peers.get(to)?.close();
    const p = new Peer();
    this.peers.set(to, p);
    for (const tr of stream.getVideoTracks())
      p.pc.addTransceiver(tr, { direction: "sendonly", streams: [stream], sendEncodings: [SEND] });
    p.pc.onicecandidate = (e) => {
      if (e.candidate) this.t.send({ t: "ice", from: this.sid, to, c: e.candidate.toJSON() });
    };
    p.pc.onconnectionstatechange = () => {
      this.onChange();
      // 끊기면(공유기 순간 끊김 등) 학생이 아직 방에 있을 때 다시 건다
      if (p.pc.connectionState === "failed" && this.peers.get(to) === p)
        setTimeout(() => {
          if (this.peers.get(to) === p && this.students.some((s) => s.sid === to)) void this.offer(to);
        }, 2000);
    };
    const o = await p.pc.createOffer();
    await p.pc.setLocalDescription(o);
    this.t.send({ t: "offer", from: this.sid, to, sdp: p.pc.localDescription!.toJSON() });
  }

  private onMsg(m: Msg) {
    if (!("to" in m) || m.to !== this.sid) return;
    if (m.t === "moffer") return void this.monitorOffer(m.from, m.sdp).catch(() => {});
    if (m.t === "mice") return void this.monitors.get(m.from)?.peer.ice(m.c);
    const p = this.peers.get(m.from);
    if (!p) return;
    if (m.t === "answer") void p.remote(m.sdp).catch(() => {});
    else if (m.t === "ice") void p.ice(m.c);
  }

  private closePeers() {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
  }

  // 학생이 연 감독 연결을 받는다. 학생 → 강사 단방향 데이터 채널 하나.
  private async monitorOffer(from: string, sdp: RTCSessionDescriptionInit) {
    this.dropMonitor(from);
    const peer = new Peer();
    const entry: { peer: Peer; dc?: RTCDataChannel } = { peer };
    this.monitors.set(from, entry);
    peer.pc.onicecandidate = (e) => {
      if (e.candidate) this.t.send({ t: "mice", from: this.sid, to: from, c: e.candidate.toJSON() });
    };
    peer.pc.ondatachannel = (e) => {
      const dc = e.channel;
      dc.binaryType = "arraybuffer";
      entry.dc = dc;
      dc.onmessage = (ev) => this.onWatch(from, ev.data);
    };
    await peer.remote(sdp);
    const a = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(a);
    this.t.send({ t: "manswer", from: this.sid, to: from, sdp: peer.pc.localDescription!.toJSON() });
  }

  private onWatch(sid: string, data: unknown) {
    const w: Watch = { ...this.watch.get(sid) };
    if (typeof data === "string") {
      try {
        const j = JSON.parse(data);
        if (j.k !== "act") return;
        w.activity = { app: j.app ?? null, title: String(j.title ?? "").slice(0, 200), at: Date.now() };
      } catch {
        return;
      }
    } else if (data instanceof ArrayBuffer && data.byteLength > 1) {
      const u8 = new Uint8Array(data);
      const url = URL.createObjectURL(new Blob([u8.subarray(1)], { type: "image/jpeg" }));
      const key = u8[0] === SHOT_BIG ? "big" : "shot";
      if (w[key]) URL.revokeObjectURL(w[key]);
      w[key] = url;
    } else return;
    this.watch.set(sid, w);
    this.onChange();
  }

  private dropMonitor(sid: string) {
    const m = this.monitors.get(sid);
    if (m) {
      m.dc?.close();
      m.peer.close();
      this.monitors.delete(sid);
    }
    const w = this.watch.get(sid);
    if (w?.shot) URL.revokeObjectURL(w.shot);
    if (w?.big) URL.revokeObjectURL(w.big);
    this.watch.delete(sid);
  }
}

// ───────────────────────── 학생 ─────────────────────────

export class StudentLive {
  stream: MediaStream | null = null;
  teacherOnline = false;
  teacherSharing = false;
  private peer: Peer | null = null;
  private teacherSid: string | null = null;
  private seenTeacher = false;
  private mon: Peer | null = null;
  private dc: RTCDataChannel | null = null;
  private monTeacher: string | null = null;
  private me: Meta;
  /** 강사가 크게 보기를 눌렀을 때 (화면 쪽이 큰 그림을 찍어 sendShot("big")으로 보낸다) */
  onWant: (() => void) | null = null;

  constructor(
    private t: Transport,
    me: Omit<Meta, "role">,
    private onChange: () => void,
    /** 강사 명령이 오면 부른다 — 서버 검증·잠금 프로그램 호출은 화면 쪽 책임 */
    private onCmd: (signed: SignedCmd) => void
  ) {
    this.me = { ...me, role: "student" };
    t.onMessage((m) => this.onMsg(m));
    t.onPresence((metas) => {
      const teachers = metas.filter((x) => x.role === "teacher");
      this.teacherOnline = teachers.length > 0;
      // 감독 연결: 강사가 바뀌었으면(새로고침) 다시 열고, 강사가 없으면 닫는다
      if (!teachers.some((x) => x.sid === this.monTeacher)) {
        if (teachers[0]) void this.startMonitor(teachers[0].sid).catch(() => {});
        else this.closeMonitor();
      }
      this.teacherSharing = teachers.some((x) => x.sharing);
      // offer가 강사 Presence보다 먼저 도착할 수 있다 — Presence에서 그 강사를 한 번이라도 본 뒤에만
      // "공유를 껐다 / 나갔다"로 판단한다. 안 그러면 막 받은 화면을 바로 버린다.
      // 공유를 껐다 다시 켤 때도 마찬가지 — 옛 Presence(sharing:false)가 새 offer보다 늦게 올 수 있어서
      // "공유 중"인 모습을 한 번 본 뒤에만 판단한다 (명시적으로 끈 건 "ended" 메시지가 따로 온다).
      if (this.teacherSid && this.stream) {
        const cur = teachers.find((x) => x.sid === this.teacherSid);
        if (cur?.sharing) this.seenTeacher = true;
        if (this.seenTeacher && !cur?.sharing) this.drop();
      }
      this.onChange();
    });
    t.track(this.me);
  }

  get sid() {
    return this.me.sid;
  }

  /** 상태가 바뀔 때마다 Presence를 갱신해 강사 화면에 반영한다. */
  update(patch: Partial<Meta>) {
    const next = { ...this.me, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.me)) return;
    this.me = next;
    this.t.track(this.me);
  }

  close() {
    this.drop();
    this.closeMonitor();
    this.t.close();
  }

  /** 감독 연결이 열려 있어 보낼 수 있는지 */
  get monitoring() {
    return this.dc?.readyState === "open";
  }

  sendActivity(a: { app: string | null; title: string }) {
    if (this.monitoring) this.dc!.send(JSON.stringify({ k: "act", ...a }));
  }

  sendShot(kind: "thumb" | "big", jpeg: ArrayBuffer) {
    if (!this.monitoring || jpeg.byteLength > 250_000) return; // 데이터 채널 한 번에 안전한 크기
    const u8 = new Uint8Array(jpeg.byteLength + 1);
    u8[0] = kind === "big" ? SHOT_BIG : SHOT_THUMB;
    u8.set(new Uint8Array(jpeg), 1);
    this.dc!.send(u8);
  }

  private async startMonitor(to: string) {
    this.closeMonitor();
    const p = new Peer();
    this.mon = p;
    this.monTeacher = to;
    const dc = p.pc.createDataChannel("watch");
    this.dc = dc;
    dc.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      try {
        if (JSON.parse(e.data).k === "want") this.onWant?.();
      } catch {}
    };
    p.pc.onicecandidate = (e) => {
      if (e.candidate) this.t.send({ t: "mice", from: this.sid, to, c: e.candidate.toJSON() });
    };
    p.pc.onconnectionstatechange = () => {
      // 끊기면 같은 강사에게 다시 연다
      if (p.pc.connectionState === "failed" && this.mon === p)
        setTimeout(() => {
          if (this.mon === p) void this.startMonitor(to).catch(() => {});
        }, 3000);
    };
    const o = await p.pc.createOffer();
    await p.pc.setLocalDescription(o);
    this.t.send({ t: "moffer", from: this.sid, to, sdp: p.pc.localDescription!.toJSON() });
  }

  private closeMonitor() {
    this.dc?.close();
    this.dc = null;
    this.mon?.close();
    this.mon = null;
    this.monTeacher = null;
  }

  private drop() {
    this.peer?.close();
    this.peer = null;
    this.teacherSid = null;
    this.seenTeacher = false;
    this.stream = null;
    this.update({ viewing: false });
    this.onChange();
  }

  private async onMsg(m: Msg) {
    if (m.t === "ended") {
      if (m.from === this.teacherSid) this.drop();
      return;
    }
    if (m.t === "cmd") {
      this.onCmd({ cmd: m.cmd, sig: m.sig });
      return;
    }
    if (m.to !== this.sid) return;

    if (m.t === "manswer") {
      if (m.from === this.monTeacher) await this.mon?.remote(m.sdp).catch(() => {});
      return;
    }
    if (m.t === "mice") {
      if (m.from === this.monTeacher) await this.mon?.ice(m.c);
      return;
    }

    if (m.t === "offer") {
      // 강사가 새로고침·공유 재시작하면 새 offer가 온다 — 이전 연결은 버린다
      this.peer?.close();
      const p = new Peer();
      this.peer = p;
      this.teacherSid = m.from;
      this.seenTeacher = false;
      p.pc.ontrack = (e) => {
        this.stream = e.streams[0] ?? new MediaStream([e.track]);
        this.update({ viewing: true });
        this.onChange();
      };
      p.pc.onicecandidate = (e) => {
        if (e.candidate) this.t.send({ t: "ice", from: this.sid, to: m.from, c: e.candidate.toJSON() });
      };
      p.pc.onconnectionstatechange = () => {
        if (this.peer !== p) return;
        const s = p.pc.connectionState;
        if (s === "failed" || s === "closed") this.update({ viewing: false });
        this.onChange();
      };
      await p.remote(m.sdp);
      const a = await p.pc.createAnswer();
      await p.pc.setLocalDescription(a);
      this.t.send({ t: "answer", from: this.sid, to: m.from, sdp: p.pc.localDescription!.toJSON() });
    } else if (m.t === "ice" && m.from === this.teacherSid) {
      await this.peer?.ice(m.c);
    }
  }
}

// ───────────────────────── 잠금 프로그램 ─────────────────────────
//
// 학생 PC에 깐 ssaem-lock.exe가 127.0.0.1:47800에서 기다린다. 브라우저는 OS를 못 건드리니
// "수업 탭이 서버 검증을 마친 명령을 이 PC의 잠금 프로그램에 넘기는" 다리 역할만 한다.
// 잠금 프로그램은 요청의 Origin이 등록된 쌤 주소일 때만 따른다 (다른 사이트가 못 부르게).

export const AGENT_URL = "http://127.0.0.1:47800";

export type AgentStatus = { ok: true; v: string; mode: AgentMode } | null;

async function agentFetch(path: string, body?: unknown): Promise<AgentStatus> {
  try {
    const r = await fetch(AGENT_URL + path, {
      method: body === undefined ? "GET" : "POST",
      // text/plain = 단순 요청 → 사전 요청(OPTIONS) 없이 간다
      headers: body === undefined ? undefined : { "Content-Type": "text/plain" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return null;
    return (await r.json()) as AgentStatus;
  } catch {
    return null; // 안 깔렸거나 꺼져 있음
  }
}

/** 살아 있음 신호 겸 상태 조회. 잠금 프로그램은 이게 끊기면 일정 시간 뒤 스스로 풀린다. */
export const agentBeat = () => agentFetch("/beat", {});
// win = 이 탭 제목 — 보기 모드에서 잠금 프로그램이 이 창을 찾아 맨 앞으로 올린다 (1.2)
export const agentCommand = (action: "lock" | "watch" | "unlock", text?: string) =>
  agentFetch("/cmd", { action, text: text ?? "", win: document.title });
export const AGENT_LATEST = "1.3";

/** 지금 맨 앞 창의 프로그램 이름·창 제목. 잠금 프로그램이 없거나 1.0이면 null */
export async function agentActivity(): Promise<{ app: string; title: string } | null> {
  try {
    const r = await fetch(AGENT_URL + "/activity", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return null;
    const d = await r.json();
    return { app: String(d.app ?? ""), title: String(d.title ?? "") };
  } catch {
    return null;
  }
}

/** 화면 사진 (JPEG). w = 가로 픽셀 */
export async function agentShot(w: number, q = 60): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(`${AGENT_URL}/shot?w=${w}&q=${q}`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}

// 수업 중 딴짓으로 볼 프로그램·창 제목. 프로그램 이름이나 창 제목에 들어 있으면 강사 화면에서 빨갛게.
// 창 제목은 브라우저 탭 제목이 그대로 온다 ("유튜브 - Chrome") — 웹으로 보는 것도 걸린다.
const OFF_APPS = ["kakaotalk", "discord", "telegram", "line", "steam", "leagueclient", "battle.net"];
const OFF_TITLES = [
  "카카오톡", "kakaotalk", "youtube", "유튜브", "netflix", "넷플릭스", "치지직", "chzzk", "soop", "아프리카tv",
  "twitch", "트위치", "instagram", "인스타그램", "facebook", "페이스북", "tiktok", "틱톡", "웹툰", "webtoon",
  "discord", "디스코드",
];

export function isOffTask(a: Activity | undefined): boolean {
  if (!a?.app) return false;
  const title = a.title.toLowerCase();
  return OFF_APPS.includes(a.app.toLowerCase()) || OFF_TITLES.some((k) => title.includes(k));
}

// 자주 보는 프로그램 이름을 한글로
const APP_NAMES: Record<string, string> = {
  kakaotalk: "카카오톡",
  chrome: "크롬",
  msedge: "엣지",
  whale: "웨일",
  firefox: "파이어폭스",
  excel: "엑셀",
  winword: "워드",
  powerpnt: "파워포인트",
  hwp: "한글",
  explorer: "파일 탐색기",
  notepad: "메모장",
  discord: "디스코드",
};

export function appLabel(app: string | null): string {
  if (app === null) return "";
  if (!app) return "바탕화면";
  return APP_NAMES[app.toLowerCase()] ?? app;
}
