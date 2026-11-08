"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import { TeacherLive, appLabel, isOffTask, newSid, type AgentMode, type Meta, type Watch } from "@/lib/live";
import { supabaseTransport } from "@/lib/live-supabase";

type Room = { teacher: string; name: string; channel: string };
type Action = "lock" | "watch" | "unlock";

// 잠금 프로그램에 기본으로 들어 있는 주소. 다른 주소(학원 도메인)로 접속 중이면 ini 안내를 띄운다.
const AGENT_ORIGINS = ["https://ssaem-mychat-s-projects.vercel.app", "http://localhost:3000"];

// 학생 PC 바로가기 (설치 없이 화면 보기). Edge를 전용 프로필로 따로 띄워야 플래그가 먹는다 — 이미 켜진
// Edge 창에 붙으면 플래그가 무시된다. 플래그 값은 ASCII만 받아서 화면 이름이 영어가 되게 --lang=en-US.
// 화면이 둘 이상이면 소스 이름이 "Screen 1"·"Screen 2"로 바뀐다 → 개수를 세서 첫 화면을 고른다.
// 전부 ASCII라 코드페이지(chcp) 걱정이 없다. 줄바꿈은 CRLF.
function liveBat(origin: string) {
  return String.raw`@echo off
rem ssaem live class - opens a dedicated Edge window that shares this PC's screen with the teacher
setlocal
set "URL=${origin}/live"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "SRC=Entire screen"
for /f %%n in ('powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens.Count"') do if not "%%n"=="1" set "SRC=Screen 1"
start "" "%EDGE%" --user-data-dir="C:\ssaem\edge" --no-first-run --no-default-browser-check --lang=en-US "--auto-select-desktop-capture-source=%SRC%" --app=%URL%
`.replace(/\n/g, "\r\n");
}

function downloadBat(origin: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([liveBat(origin)], { type: "application/octet-stream" }));
  a.download = "ssaem-live.bat";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const MODE_LABEL: Record<AgentMode, string> = { none: "", lock: "잠김", watch: "화면 보기" };
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
  const [lockText, setLockText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // 내가 건 모드: 전체 + 학생별 예외. 늦게 들어온 학생에게도 같은 모드를 다시 건다.
  const [allMode, setAllMode] = useState<AgentMode>("none");
  const [perStudent, setPerStudent] = useState<Record<string, AgentMode>>({});
  const [origin, setOrigin] = useState("");

  const liveRef = useRef<TeacherLive | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const resent = useRef<Record<string, number>>({});
  const seen = useRef<Map<string, string>>(new Map()); // uid → 이름

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
      for (const s of list) {
        const want = perStudent[s.uid] ?? allMode;
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
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 15 } },
        audio: false,
      });
      liveRef.current?.share(stream);
      if (previewRef.current) previewRef.current.srcObject = stream;
    } catch {
      setErr("화면 공유를 시작하지 못했어요. 공유할 화면을 고른 뒤 [공유]를 눌러 주세요.");
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
      body: JSON.stringify({ action, targets, text: action === "lock" ? lockText.trim() : undefined }),
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
      resent.current = {};
    }
    setBusy(false);
  }

  async function setOne(uid: string, action: Action) {
    if (await send(action, [uid])) setPerStudent((p) => ({ ...p, [uid]: toMode(action) }));
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
              <button disabled={busy} onClick={() => setAll("watch")} className="btn btn-gray px-4 h-10">
                모두 화면 보기
              </button>
              <button disabled={busy} onClick={() => setAll("lock")} className="btn btn-gray px-4 h-10">
                모두 잠금
              </button>
              <button disabled={busy} onClick={() => setAll("unlock")} className="btn btn-primary px-4 h-10">
                모두 해제
              </button>
            </div>
            <input
              className="field"
              placeholder="잠금 화면 문구 (비우면 “선생님이 화면을 잠갔어요”)"
              maxLength={100}
              value={lockText}
              onChange={(e) => setLockText(e.target.value)}
            />
            <p className="text-sub text-[13px]">
              화면 보기 = 내 화면을 학생 PC에 꽉 채우고 키보드·마우스를 막아요. 잠금 = 화면을 가리고 막아요.
            </p>
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
                  // 학생이 공유를 끄면 마지막 사진이 남아 있어도 "꺼짐"으로 보여야 한다
                  const shot = s.agent || s.browserShare ? w?.shot : undefined;
                  return (
                    <article
                      key={s.sid}
                      className="card p-4 flex flex-col gap-2 min-w-0"
                      style={off ? { boxShadow: "inset 0 0 0 2px var(--red)" } : undefined}
                    >
                      <button
                        onClick={() => setZoom(s.sid)}
                        disabled={!shot}
                        className="w-full aspect-video rounded-[8px] overflow-hidden grid place-items-center text-[12px] text-white/60"
                        style={{ background: "#0f1722" }}
                        aria-label={`${s.name} 화면 크게 보기`}
                      >
                        {shot ? (
                          // eslint-disable-next-line @next/next/no-img-element -- 학생 PC가 보낸 사진(blob URL)
                          <img src={shot} alt="" className="w-full h-full object-contain" />
                        ) : s.agent || s.browserShare ? (
                          "화면 받는 중…"
                        ) : (
                          <span className="px-4 text-center leading-relaxed">
                            화면 공유가 꺼져 있어요
                            <br />
                            <span className="text-[11px] text-white/45">
                              학생이 쌤 수업 바로가기로 열거나 [내 화면 보여주기]를 누르면 보여요
                            </span>
                          </span>
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
                        <span style={s.agent || s.browserShare ? undefined : { color: "var(--red)" }}>
                          {s.agent ? "잠금 프로그램 ✓" : s.browserShare ? "브라우저 공유" : "잠금 프로그램 없음"}
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
                        <button onClick={() => setOne(s.uid, "lock")} className="btn btn-gray px-3 h-9 !text-[13px]">
                          잠금
                        </button>
                        <button onClick={() => setOne(s.uid, "watch")} className="btn btn-gray px-3 h-9 !text-[13px]">
                          화면 보기
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

          <section className="card p-5 flex flex-col gap-2 text-[14px]">
            <p className="text-[16px] font-bold">설치 없이 — 바로가기로 화면 보기</p>
            <p className="text-sub">
              프로그램을 깔 수 없는 PC라면, 바로가기로 수업을 열기만 해도 학생 화면 미리보기가 보여요. 바로가기는 지금
              주소({origin || "…"})로 만들어져요.
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-text-2">
              <li>
                학생 PC에서{" "}
                <button
                  onClick={() => downloadBat(origin)}
                  disabled={!origin}
                  className="font-bold underline"
                  style={{ color: "var(--blue)" }}
                >
                  ssaem-live.bat 내려받기
                </button>{" "}
                → <b>C:\ssaem</b> 폴더로 옮기기 (브라우저가 “위험할 수 있는 파일”이라 하면 <b>유지</b>)
              </li>
              <li>
                파일을 오른쪽 클릭 → <b>보내기 → 바탕 화면에 바로 가기 만들기</b>. 바로 가기 이름은 “쌤 수업”처럼
                바꿔도 돼요.
              </li>
              <li>
                처음 한 번은 바로 가기로 연 창에서 학생이 로그인 — 다음부터는 로그인이 유지돼요. 수업 때는 바로 가기만
                열면 끝.
              </li>
            </ol>
            <p className="text-sub text-[13px]">
              한계: 꼭 바로 가기로 열어야 해요(그냥 브라우저로 열면 공유할 화면을 고르는 창이 떠요). 학생이 화면
              아래 [Stop sharing]을 누르면 끊기고, 여기 카드에 “화면 공유가 꺼져 있어요”로 떠요. PC 잠금과 지금 쓰는
              프로그램(딴짓) 확인은 잠금 프로그램이 있어야 돼요.
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
