"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useGate } from "@/components/RoleGuard";
import { StudentLive, agentBeat, agentCommand, newSid, type AgentMode, type SignedCmd } from "@/lib/live";
import { supabaseTransport } from "@/lib/live-supabase";

type Room = { teacher: string; name: string; channel: string };
type Shot = { url: string; name: string };

const ROOM_KEY = "ssaem.live.room";

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}

// 학생 — 실시간 수업 (PC실). 선생님 화면을 받아 보고, 캡처·녹화·메모를 남긴다.
// 선생님이 잠금·보기 모드를 걸면 서버 검증 뒤 이 PC의 잠금 프로그램에 넘긴다.
export default function LivePage() {
  const { session, gate, allowed } = useGate("student");
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [roomId, setRoomId] = useState<string>("");
  const [link, setLink] = useState<"connecting" | "connected" | "error">("connecting");
  // StudentLive(클래스)의 상태를 렌더용으로 복사해 둔다 — 렌더 중에 ref를 읽지 않게
  const [view, setView] = useState<{ stream: MediaStream | null; online: boolean; sharing: boolean }>({
    stream: null,
    online: false,
    sharing: false,
  });
  const [mode, setMode] = useState<AgentMode>("none");
  const [lockText, setLockText] = useState("");
  const [agent, setAgent] = useState<boolean | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [recording, setRecording] = useState(false);
  const [memo, setMemo] = useState("");
  const [cmdErr, setCmdErr] = useState("");

  const liveRef = useRef<StudentLive | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const lastCmd = useRef("");
  const token = session?.access_token;

  // 입장 정보 (수강 중인 선생님 방)
  useEffect(() => {
    if (!allowed || !token) return;
    fetch("/api/live", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        const list: Room[] = d.rooms ?? [];
        setRooms(list);
        setMe(d.me ? { id: d.me.id, name: d.me.name } : null);
        let saved = "";
        try {
          saved = localStorage.getItem(ROOM_KEY) ?? "";
        } catch {}
        setRoomId(list.some((r) => r.teacher === saved) ? saved : list[0]?.teacher ?? "");
      })
      .catch(() => setRooms([]));
  }, [allowed, token]);

  const room = rooms?.find((r) => r.teacher === roomId) ?? null;

  // 선생님 명령: 서버 검증 → 화면 오버레이 + 잠금 프로그램
  const onCmd = useCallback(
    async (s: SignedCmd) => {
      if (!me || !token || !room) return;
      if (s.cmd.teacher !== room.teacher) return;
      if (s.cmd.targets !== "all" && !s.cmd.targets.includes(me.id)) return;
      const key = `${s.cmd.ts}:${s.sig}`;
      if (lastCmd.current === key) return;
      lastCmd.current = key;
      const r = await fetch("/api/live/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(s),
      });
      if (!r.ok) {
        setCmdErr((await r.json().catch(() => null))?.error ?? "선생님 명령을 확인하지 못했어요");
        return;
      }
      setCmdErr("");
      const next: AgentMode = s.cmd.action === "unlock" ? "none" : s.cmd.action;
      setMode(next);
      setLockText(s.cmd.text ?? "");
      const st = await agentCommand(s.cmd.action, s.cmd.text);
      setAgent(Boolean(st));
      liveRef.current?.update({ mode: next, agent: Boolean(st) });
    },
    [me, token, room]
  );
  const onCmdRef = useRef(onCmd);
  useEffect(() => {
    onCmdRef.current = onCmd;
  }, [onCmd]);

  // 수업방 연결
  useEffect(() => {
    if (!room || !me) return;
    try {
      localStorage.setItem(ROOM_KEY, room.teacher);
    } catch {}
    const sid = newSid();
    const t = supabaseTransport(room.channel, sid, (s) => setLink(s));
    const live: StudentLive = new StudentLive(
      t,
      { sid, uid: me.id, name: me.name || "학생", viewing: false, away: document.hidden, mode: "none" },
      () => setView({ stream: live.stream, online: live.teacherOnline, sharing: live.teacherSharing }),
      (s) => void onCmdRef.current(s)
    );
    liveRef.current = live;
    return () => {
      live.close();
      liveRef.current = null;
      setLink("connecting");
      setView({ stream: null, online: false, sharing: false });
    };
  }, [room, me]);

  // 받은 화면을 video에 연결
  const stream = view.stream;
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.srcObject !== stream) v.srcObject = stream;
    // 녹화 중에 화면이 바뀌면(선생님이 공유를 다시 시작) 지금까지 녹화한 걸 저장한다
    if (recRef.current && recRef.current.stream !== stream) recRef.current.stop();
  }, [stream, mode]);

  // 다른 창으로 나갔는지 — 강사 화면 학생 목록에 "다른 창"으로 뜬다
  useEffect(() => {
    const report = () => liveRef.current?.update({ away: document.hidden || !document.hasFocus() });
    window.addEventListener("blur", report);
    window.addEventListener("focus", report);
    document.addEventListener("visibilitychange", report);
    return () => {
      window.removeEventListener("blur", report);
      window.removeEventListener("focus", report);
      document.removeEventListener("visibilitychange", report);
    };
  }, []);

  // 잠금 프로그램 살아 있음 신호 (끊기면 프로그램이 90초 뒤 스스로 풀린다)
  useEffect(() => {
    if (!room) return;
    let alive = true;
    const beat = async () => {
      const st = await agentBeat();
      if (!alive) return;
      setAgent(Boolean(st));
      liveRef.current?.update({ agent: Boolean(st) });
    };
    void beat();
    const id = setInterval(beat, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [room]);

  // 메모는 선생님 방별로 이 PC에 저장
  useEffect(() => {
    if (!room) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 방을 바꿀 때 저장된 메모를 한 번 불러오는 것
      setMemo(localStorage.getItem(`ssaem.live.memo.${room.teacher}`) ?? "");
    } catch {}
  }, [room]);
  function saveMemo(v: string) {
    setMemo(v);
    try {
      if (room) localStorage.setItem(`ssaem.live.memo.${room.teacher}`, v);
    } catch {}
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const shot = { url: URL.createObjectURL(b), name: `수업캡처_${stamp()}.png` };
      setShots((p) => [shot, ...p]);
      download(shot.url, shot.name);
    }, "image/png");
  }

  function toggleRecord() {
    if (recRef.current) {
      recRef.current.stop();
      return;
    }
    if (!stream) return;
    const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t)
    );
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    const name = `수업녹화_${stamp()}.webm`;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      recRef.current = null;
      setRecording(false);
      if (chunks.length) download(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })), name);
    };
    rec.start(1000);
    recRef.current = rec;
    setRecording(true);
  }

  if (gate) return gate;

  const status = !room
    ? ""
    : link === "error"
      ? "수업방에 연결하지 못했어요. 인터넷 연결을 확인해 주세요."
      : link === "connecting"
        ? "수업방에 들어가는 중이에요…"
        : !view.online
          ? "선생님이 아직 수업방에 없어요."
          : !view.sharing
            ? "선생님이 화면 공유를 시작하면 여기에 보여요."
            : !stream
              ? "선생님 화면을 받는 중이에요…"
              : "";

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1400px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] lg:text-[28px] font-bold">실시간 수업</h1>
          <p className="text-sub text-[14px] lg:text-[15px]">선생님 화면을 보면서 캡처·녹화하고 메모를 남겨요.</p>
        </div>
        {rooms && rooms.length > 1 && (
          <select
            className="field !w-auto"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            aria-label="수업방 선택"
          >
            {rooms.map((r) => (
              <option key={r.teacher} value={r.teacher}>
                {r.name} 선생님
              </option>
            ))}
          </select>
        )}
      </div>

      {rooms === null && <div className="skel h-[360px] !rounded-[16px]" />}
      {rooms?.length === 0 && (
        <div className="card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">수강 중인 선생님이 없어요</p>
          <p className="text-sub text-[13px]">선생님 초대 링크나 코드로 먼저 수강 등록을 해 주세요.</p>
        </div>
      )}

      {room && (
        <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
          <section className="flex flex-col gap-3 min-w-0">
            <div
              ref={stageRef}
              className="relative w-full aspect-video rounded-[16px] overflow-hidden grid place-items-center"
              style={{ background: "#0f1722" }}
            >
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              {status && (
                <p className="absolute inset-0 grid place-items-center text-center px-6 text-[15px] text-white/80">
                  {status}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={capture} disabled={!stream} className="btn btn-primary px-5 h-11">
                캡처
              </button>
              <button onClick={toggleRecord} disabled={!stream && !recording} className="btn btn-gray px-5 h-11">
                {recording ? "● 녹화 멈추고 저장" : "녹화 시작"}
              </button>
              <button
                onClick={() => stageRef.current?.requestFullscreen?.()}
                disabled={!stream}
                className="btn btn-gray px-5 h-11"
              >
                크게 보기
              </button>
            </div>
            {shots.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {shots.map((s) => (
                  <a key={s.url} href={s.url} download={s.name} className="shrink-0" title={`${s.name} 다시 받기`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- 이 PC 메모리의 캡처(blob URL) */}
                    <img src={s.url} alt={s.name} className="h-20 rounded-[8px] border border-line" />
                  </a>
                ))}
              </div>
            )}
            <p className="text-sub text-[13px]">캡처·녹화 파일은 이 PC의 다운로드 폴더에 저장돼요.</p>
          </section>

          <aside className="card p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[16px] font-bold">수업 메모</h2>
              <button
                className="btn btn-ghost px-2 !text-[13px]"
                disabled={!memo.trim()}
                onClick={() =>
                  download(
                    URL.createObjectURL(new Blob([memo], { type: "text/plain;charset=utf-8" })),
                    `수업메모_${stamp()}.txt`
                  )
                }
              >
                내려받기
              </button>
            </div>
            <textarea
              className="field min-h-[260px] lg:min-h-[420px] !text-[14px] leading-relaxed"
              placeholder="선생님 설명을 적어 두세요. 이 PC에 자동 저장돼요."
              value={memo}
              onChange={(e) => saveMemo(e.target.value)}
            />
            <p className="text-[12px] text-sub">
              잠금 프로그램 {agent === null ? "확인 중" : agent ? "연결됨" : "없음"}
              {cmdErr && <span style={{ color: "var(--red)" }}> · {cmdErr}</span>}
            </p>
          </aside>
        </div>
      )}

      {/* 선생님이 건 모드 — 잠금 프로그램이 없는 PC에서도 수업 탭만큼은 가린다 */}
      {mode === "lock" && (
        <div className="fixed inset-0 z-[100] grid place-items-center text-center px-6" style={{ background: "#1e3a5f" }}>
          <div className="text-white">
            <p className="text-[28px] lg:text-[36px] font-bold">{lockText || "선생님이 화면을 잠갔어요"}</p>
            <p className="mt-3 text-[16px] text-white/70">잠시 선생님을 봐 주세요</p>
          </div>
        </div>
      )}
      {mode === "watch" && (
        <WatchOverlay stream={stream} />
      )}
    </main>
  );
}

// 보기 모드 — 선생님 화면을 꽉 채워 보여준다 (키보드·마우스는 잠금 프로그램이 막는다)
function WatchOverlay({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center" style={{ background: "#0f1722" }}>
      <video ref={ref} autoPlay playsInline muted className="w-full h-full object-contain" />
      {!stream && <p className="absolute text-white/80 text-[16px]">선생님 화면을 기다리는 중이에요…</p>}
    </div>
  );
}
