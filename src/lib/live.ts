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
  | { t: "cmd"; from: string; cmd: SignedCmd["cmd"]; sig: string };

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
  private peers = new Map<string, Peer>();
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

  close() {
    this.stop();
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
    const p = this.peers.get(m.from);
    if (!p) return;
    if (m.t === "answer") void p.remote(m.sdp).catch(() => {});
    else if (m.t === "ice") void p.ice(m.c);
  }

  private closePeers() {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
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
  private me: Meta;

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
      this.teacherSharing = teachers.some((x) => x.sharing);
      // offer가 강사 Presence보다 먼저 도착할 수 있다 — Presence에서 그 강사를 한 번이라도 본 뒤에만
      // "공유를 껐다 / 나갔다"로 판단한다. 안 그러면 막 받은 화면을 바로 버린다.
      if (this.teacherSid && this.stream) {
        const cur = teachers.find((x) => x.sid === this.teacherSid);
        if (cur) this.seenTeacher = true;
        if ((cur && !cur.sharing) || (!cur && this.seenTeacher)) this.drop();
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
    this.t.close();
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
export const agentCommand = (action: "lock" | "watch" | "unlock", text?: string) =>
  agentFetch("/cmd", { action, text: text ?? "" });
