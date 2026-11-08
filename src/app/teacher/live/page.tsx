"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import { AGENT_LATEST, TeacherLive, appLabel, isOffTask, newSid, type AgentMode, type Meta, type Watch } from "@/lib/live";
import { supabaseTransport } from "@/lib/live-supabase";

type Room = { teacher: string; name: string; channel: string };
type Action = "lock" | "watch" | "unlock";

// 잠금 프로그램에 기본으로 들어 있는 주소. 다른 주소(학원 도메인)로 접속 중이면 ini 안내를 띄운다.
const AGENT_ORIGINS = ["https://ssaem-mychat-s-projects.vercel.app", "http://localhost:3000"];

// 잠금 = 학생 PC에 내 화면만 보이게(watch). lock(잠금 문구)은 이제 안 보내지만 옛 학생 탭 대비 이름은 같게.
const MODE_LABEL: Record<AgentMode, string> = { none: "", lock: "잠김", watch: "잠김" };
const toMode = (a: Action): AgentMode => (a === "unlock" ? "none" : a);

// 강사 — 실시간 수업 (PC실). 내 화면을 학생 PC에 띄우고, 학생 PC를 잠그거나 보기 모드로 묶는다.
export default function TeacherLivePage() {
  const { session, gate, allowed } = useGate("teacher");
  const token = session?.access_token;
  const [room, setRoom] = useState<Room | null | undefined>(undefined);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [link, setLink] = useState<"connecting" | "connected" | "error">("connecting");
  // TeacherLive(클래스)의 상태를 렌더용으로 복사해 둔다 — 렌더 중에 ref를 읽지 않게
  const [view, setView] = useState<{
    students: Meta[];
    sharing: boolean;
    conns: Record<string, RTCPeerConnectionState | "none">;
    watch: Record<string, Watch>;
    /** 이번 수업에 들어왔다가 나간 학생 (수업 탭을 닫으면 감독도 끊긴다 — 그것도 신호) */
    left: { uid: string; name: string }[];
  }>({ students: [], sharing: false, conns: {}, watch: {}, left: [] });
  // 크게 보는 학생 sid
  const [zoom, setZoom] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // 내가 건 모드: 전체 + 학생별 예외. 늦게 들어온 학생에게도 같은 모드를 다시 건다.
  const [allMode, setAllMode] = useState<AgentMode>("none");
  const [perStudent, setPerStudent] = useState<Record<string, AgentMode>>({});
  const [origin, setOrigin] = useState("");

  const liveRef = useRef<TeacherLive | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const resent = useRef<Record<string, number>>({});
  const seen = useRef<Map<string, string>>(new Map()); // uid → 이름
  const wasSharing = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저에서만 아는 값(현재 주소)을 한 번 읽는 것
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!allowed || !token) return;
    fetch("/api/live", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setRoom(d.rooms?.[0] ?? null);
        setMe(d.me ? { id: d.me.id, name: d.me.name } : null);
      })
      .catch(() => setRoom(null));
  }, [allowed, token]);

  useEffect(() => {
    if (!room || !me) return;
    const sid = newSid();
    const t = supabaseTransport(room.channel, sid, (s) => setLink(s));
    const live: TeacherLive = new TeacherLive(t, { sid, uid: me.id, name: me.name || "선생님" }, () => {
      for (const s of live.students) seen.current.set(s.uid, s.name);
      const here = new Set(live.students.map((s) => s.uid));
      setView({
        students: [...live.students],
        sharing: Boolean(live.stream),
        conns: Object.fromEntries(live.students.map((s) => [s.sid, live.stateOf(s.sid)])),
        watch: Object.fromEntries(live.watch),
        left: [...seen.current].filter(([uid]) => !here.has(uid)).map(([uid, name]) => ({ uid, name })),
      });
      // 공유를 끄면(브라우저의 [공유 중지] 포함) 잠긴 학생은 검은 화면에 손발만 묶인다 — 잠금도 같이 푼다.
      // 실제 unlock은 아래 reconcile이 보낸다. 방금 보낸 학생에게도 바로 보내야 하니 재전송 대기를 비운다 — 전환 때 한 번만.
      const sharing = Boolean(live.stream);
      if (sharing !== wasSharing.current) {
        wasSharing.current = sharing;
        resent.current = {};
        if (!sharing) {
          setAllMode("none");
          setPerStudent({});
          if (live.students.some((s) => (s.mode ?? "none") !== "none")) setNote("화면 공유를 끄면 잠금도 풀려요.");
        }
      }
      reconcileRef.current(live.students);
    });
    liveRef.current = live;
    // 강사가 탭을 닫으면 학생 쪽 화면도 정리되게
    const bye = () => live.close();
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      live.close();
      liveRef.current = null;
    };
  }, [room, me]);

  // 늦게 들어왔거나 새로고침한 학생은 모드가 안 걸려 있다 — 내가 건 모드와 다르면 다시 보낸다.
  // 학생 목록이 바뀔 때(TeacherLive 콜백) 부른다. 최신 모드·토큰을 보도록 ref로 건넨다.
  const reconcileRef = useRef<(list: Meta[]) => void>(() => {});
  useEffect(() => {
    reconcileRef.current = (list) => {
      const now = Date.now();
      const groups: Record<Action, string[]> = { lock: [], watch: [], unlock: [] };
      const sharing = Boolean(liveRef.current?.stream);
      for (const s of list) {
        const set = perStudent[s.uid] ?? allMode;
        const want: AgentMode = set === "none" || !sharing ? "none" : "watch";
        if ((s.mode ?? "none") === want) continue;
        if (now - (resent.current[s.uid] ?? 0) < 8000) continue; // 적용 중일 수 있으니 잠깐 기다린다
        resent.current[s.uid] = now;
        groups[want === "none" ? "unlock" : want].push(s.uid);
      }
      for (const a of Object.keys(groups) as Action[])
        if (groups[a].length) void send(a, [...new Set(groups[a])]);
    };
  });

  async function share() {
    setErr("");
    setNote("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 15 } },
        audio: false,
      });
      liveRef.current?.share(stream);
      if (previewRef.current) previewRef.current.srcObject = stream;
      return true;
    } catch {
      setErr("화면 공유를 시작하지 못했어요. 공유할 화면을 고른 뒤 [공유]를 눌러 주세요.");
      return false;
    }
  }

  function stop() {
    liveRef.current?.stop();
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  // 서버 서명 → 채널 전송
  async function send(action: Action, targets: "all" | string[]) {
    if (!token || !liveRef.current) return false;
    const r = await fetch("/api/live/command", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, targets }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.cmd) {
      setErr(d?.error ?? "명령을 보내지 못했어요.");
      return false;
    }
    liveRef.current.command(d);
    return true;
  }

  async function setAll(action: Action) {
    setBusy(true);
    setErr("");
    if (await send(action, "all")) {
      setAllMode(toMode(action));
      setPerStudent({});
      // 방금 "all"로 보냈다 — 적용 전 Presence 변화로 reconcile이 같은 명령을 또 보내지 않게 지금 보낸 걸로 친다
      const now = Date.now();
      resent.current = Object.fromEntries(view.students.map((s) => [s.uid, now]));
    }
    setBusy(false);
  }

  async function setOne(uid: string, action: Action) {
    if (!(await send(action, [uid]))) return;
    resent.current[uid] = Date.now(); // setAll과 같은 이유 — 적용 전에 reconcile이 또 보내지 않게
    setPerStudent((p) => ({ ...p, [uid]: toMode(action) }));
  }

  // 잠금 = 학생 PC에 내 화면만. 공유 중이 아니면 공유부터 건다 — 이 클릭이 사용자 동작이라 고르는 창을 띄울 수 있다.
  async function lock(uid?: string) {
    if (!liveRef.current?.stream && !(await share())) {
      setErr("화면 공유를 시작해야 잠글 수 있어요.");
      return;
    }
    setNote("");
    if (uid) await setOne(uid, "watch");
    else await setAll("watch");
  }

  const students = view.students;

  // 크게 보기: 열려 있는 동안 2.5초마다 큰 사진을 새로 받는다
  useEffect(() => {
    if (!zoom) return;
    liveRef.current?.requestBig(zoom);
    const id = setInterval(() => liveRef.current?.requestBig(zoom), 2500);
    return () => clearInterval(id);
  }, [zoom]);
  const zoomed = zoom ? students.find((s) => s.sid === zoom) : undefined;
  const zw = zoom ? view.watch[zoom] : undefined;

  if (gate) return gate;

  const away = students.filter((s) => s.away).length;
  const noAgent = students.filter((s) => !s.agent).length;
  const offTask = students.filter((s) => isOffTask(view.watch[s.sid]?.activity)).length;
  const originKnown = !origin || AGENT_ORIGINS.includes(origin);

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">실시간 수업</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">
          내 화면을 학생 PC에 띄우고, 필요할 때 학생 PC를 잠가요. 학생은 [실시간 수업] 메뉴로 들어와요.
        </p>
      </div>

      {room === null && (
        <div className="card p-10 text-center">
          <p className="text-[15px] font-bold">수업방을 열지 못했어요</p>
        </div>
      )}

      {room && (
        <>
          <section className="card p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[16px] font-bold">{view.sharing ? "화면 공유 중" : "화면 공유 꺼짐"}</p>
                <p className="text-sub text-[13px]">
                  {link === "connected"
                    ? `학생 ${students.length}명 접속`
                    : link === "error"
                      ? "수업방에 연결하지 못했어요. 새로고침해 주세요."
                      : "수업방 여는 중…"}
                  {away > 0 && ` · 수업 탭 떠남 ${away}명`}
                  {offTask > 0 && <b style={{ color: "var(--red)" }}> · 딴짓 의심 {offTask}명</b>}
                </p>
              </div>
              {view.sharing ? (
                <button onClick={stop} className="btn btn-gray px-5 h-11">
                  공유 중지
                </button>
              ) : (
                <button onClick={share} disabled={link !== "connected"} className="btn btn-primary px-5 h-11">
                  화면 공유 시작
                </button>
              )}
            </div>
            <video
              ref={previewRef}
              autoPlay
              playsInline
              muted
              className={`w-full max-w-[420px] aspect-video rounded-[12px] ${view.sharing ? "" : "hidden"}`}
              style={{ background: "#0f1722" }}
            />
          </section>

          <section className="card p-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[16px] font-bold mr-auto">
                학생 PC 제어{" "}
                {allMode !== "none" && (
                  <span className="chip chip-on !text-[12px] align-middle">전체 {MODE_LABEL[allMode]}</span>
                )}
              </p>
              <button disabled={busy} onClick={() => lock()} className="btn btn-gray px-4 h-10">
                모두 잠금
              </button>
              <button disabled={busy} onClick={() => setAll("unlock")} className="btn btn-primary px-4 h-10">
                모두 해제
              </button>
            </div>
            <p className="text-sub text-[13px]">
              잠금 = 학생 PC에 내 화면만 보이고 키보드·마우스는 막혀요. 공유 중이 아니면 화면 공유부터 시작하고, 공유를
              끄면 잠금도 풀려요.
            </p>
            {note && <p className="text-[13px] font-bold">{note}</p>}
            {err && (
              <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
                {err}
              </p>
            )}
          </section>

          {students.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-[15px] font-bold mb-1">아직 들어온 학생이 없어요</p>
              <p className="text-sub text-[13px]">학생 PC에서 쌤에 로그인하고 [실시간 수업]을 열면 여기에 떠요.</p>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {students
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                .map((s) => {
                  const conn = view.conns[s.sid] ?? "none";
                  const mode = s.mode ?? "none";
                  const w = view.watch[s.sid];
                  const off = isOffTask(w?.activity);
                  // 1.1 이하는 잠금 해제 때 포커스를 안 돌려준다 (웹에서 메우긴 하지만 새로 받는 게 낫다)
                  const oldAgent = s.agent && Number(s.agentV) < Number(AGENT_LATEST);
                  return (
                    <article
                      key={s.sid}
                      className="card p-4 flex flex-col gap-2 min-w-0"
                      style={off ? { boxShadow: "inset 0 0 0 2px var(--red)" } : undefined}
                    >
                      <button
                        onClick={() => setZoom(s.sid)}
                        disabled={!w?.shot}
                        className="w-full aspect-video rounded-[8px] overflow-hidden grid place-items-center text-[12px] text-white/60"
                        style={{ background: "#0f1722" }}
                        aria-label={`${s.name} 화면 크게 보기`}
                      >
                        {w?.shot ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 학생 PC가 보낸 사진(blob URL)
                          <img src={w.shot} alt="" className="w-full h-full object-contain" />
                        ) : s.agent ? (
                          "화면 받는 중…"
                        ) : (
                          "잠금 프로그램을 깔면 화면이 보여요 (아래 안내)"
                        )}
                      </button>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[15px] font-bold truncate">{s.name}</p>
                        {mode !== "none" && <span className="chip chip-on !text-[12px]">{MODE_LABEL[mode]}</span>}
                      </div>
                      <p className="text-[13px] text-sub flex flex-wrap gap-x-2">
                        <span>
                          {!view.sharing
                            ? "대기"
                            : s.viewing
                              ? "화면 받는 중"
                              : conn === "failed"
                                ? "연결 실패 · 다시 거는 중"
                                : "연결 중"}
                        </span>
                        {s.away && <span style={{ color: "var(--red)" }}>수업 탭 떠남</span>}
                        <span style={s.agent && !oldAgent ? undefined : { color: "var(--red)" }}>
                          {!s.agent ? "잠금 프로그램 없음" : oldAgent ? "잠금 프로그램 새로 받기" : "잠금 프로그램 ✓"}
                        </span>
                      </p>
                      {w?.activity?.app != null && (
                        <p
                          className="text-[13px] truncate"
                          style={off ? { color: "var(--red)", fontWeight: 700 } : { color: "var(--text-2)" }}
                          title={w.activity.title}
                        >
                          지금: {appLabel(w.activity.app)}
                          {w.activity.title && ` · ${w.activity.title}`}
                        </p>
                      )}
                      <div className="flex gap-1.5">
                        <button onClick={() => lock(s.uid)} className="btn btn-gray px-3 h-9 !text-[13px]">
                          잠금
                        </button>
                        <button onClick={() => setOne(s.uid, "unlock")} className="btn btn-ghost px-3 h-9 !text-[13px]">
                          해제
                        </button>
                      </div>
                    </article>
                  );
                })}
            </div>
          )}

          {view.left.length > 0 && (
            <p className="text-[13px] text-sub">
              나간 학생: <span style={{ color: "var(--red)" }}>{view.left.map((l) => l.name).join(", ")}</span> — 수업
              화면을 닫으면 여기로 와요.
            </p>
          )}

          <section className="card p-5 flex flex-col gap-2 text-[14px]">
            <p className="text-[16px] font-bold">학생 PC 잠금 프로그램</p>
            <p className="text-sub">
              브라우저는 PC를 잠글 수 없어서, 학생 PC마다 작은 프로그램을 한 번 깔아야 해요. 안 깔린 PC는 수업
              화면만 가려지고 다른 창으로 나갈 수 있어요{noAgent > 0 && students.length > 0 && ` (지금 ${noAgent}대)`}.
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-text-2">
              <li>
                학생 PC에서{" "}
                <a href="/downloads/ssaem-lock.exe" download className="font-bold underline" style={{ color: "var(--blue)" }}>
                  ssaem-lock.exe 내려받기
                </a>{" "}
                → <b>C:\ssaem</b> 같은 고정 폴더로 옮기기
              </li>
              <li>
                두 번 눌러 실행 (“Windows의 PC 보호” 창이 뜨면 <b>추가 정보 → 실행</b>). 오른쪽 아래 방패 아이콘이
                뜨면 끝 — 다음부터는 로그인할 때 저절로 켜져요.
              </li>
              <li>학생 화면 아래에 “잠금 프로그램 연결됨”이 뜨는지 확인. 브라우저가 “로컬 네트워크 접근”을 물으면 허용.</li>
            </ol>
            {!originKnown && (
              <p className="text-[13px]" style={{ color: "var(--red)" }}>
                지금 주소({origin})는 잠금 프로그램 기본 목록에 없어요. exe와 같은 폴더에 <b>ssaem-lock.ini</b> 파일을
                만들고 <code>origin={origin}</code> 한 줄을 넣어 주세요.
              </p>
            )}
            <p className="text-sub text-[13px]">
              학생 화면 미리보기와 “지금 쓰는 프로그램”도 이 프로그램이 보내요(4초마다, 학원 PC끼리 직접 — 서버에 저장
              안 함). 카카오톡·유튜브·게임 방송 같은 건 빨간 테두리로 표시돼요. 학생 화면에는 “선생님이 볼 수 있어요”
              안내가 늘 떠 있어요.
            </p>
            <p className="text-sub text-[13px]">
              안전장치: 학생 수업 화면과 90초 넘게 연락이 끊기면 잠금이 저절로 풀려요. Ctrl+Alt+Del은 윈도우가 막지
              못하게 해 둬서 막을 수 없어요.
            </p>
          </section>
        </>
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-[100] flex flex-col p-4 lg:p-8 gap-3"
          style={{ background: "rgba(10,15,25,.92)" }}
          onClick={() => setZoom(null)}
        >
          <div className="flex items-center justify-between gap-3 text-white">
            <p className="text-[17px] font-bold truncate">
              {zoomed?.name ?? "나간 학생"}
              {zw?.activity?.app != null && (
                <span className="font-normal text-white/70">
                  {" "}
                  · {appLabel(zw.activity.app)} {zw.activity.title}
                </span>
              )}
            </p>
            <button className="btn btn-gray px-4 h-10 shrink-0" onClick={() => setZoom(null)}>
              닫기
            </button>
          </div>
          <div className="flex-1 min-h-0 grid place-items-center">
            {zw?.big || zw?.shot ? (
              // eslint-disable-next-line @next/next/no-img-element -- 학생 PC가 보낸 사진(blob URL)
              <img src={zw.big ?? zw.shot} alt="" className="max-w-full max-h-full object-contain rounded-[8px]" />
            ) : (
              <p className="text-white/70">화면을 받는 중이에요…</p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
