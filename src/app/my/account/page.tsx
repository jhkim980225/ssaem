"use client";
import { useEffect, useState } from "react";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";
import { ID_DOMAIN } from "@/lib/account";

type Note = { text: string; err: boolean } | null;

// 학생 내 정보 수정 — 이름, 비밀번호(현재 비번 확인 후).
// 아이디 계정은 재설정 메일을 못 받으니, 잊었을 땐 선생님 화면의 비밀번호 초기화로만 복구된다.
export default function MyAccountPage() {
  const { session, gate, allowed } = useGate("student", { loginMessage: "내 정보는 계정에 저장돼요." });
  const token = session?.access_token;

  const [name, setName] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<Note>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (!allowed || !token) return;
    fetch("/api/profile", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setName(d.profile?.name ?? ""))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [allowed, token]);

  if (gate) return gate;

  const loginId = (session?.user.email ?? "").split("@")[0];
  const isIdAccount = (session?.user.email ?? "").endsWith(`@${ID_DOMAIN}`);

  async function saveName() {
    if (busy) return;
    if (!name.trim()) return setMsg({ text: "이름을 입력해 주세요.", err: true });
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      const d = await r.json().catch(() => null);
      setMsg(r.ok ? { text: "이름을 바꿨어요.", err: false } : { text: d?.error || "이름을 바꾸지 못했어요.", err: true });
    } catch {
      setMsg({ text: "네트워크 오류로 바꾸지 못했어요.", err: true });
    } finally {
      setBusy(false);
    }
  }

  async function changePassword() {
    if (pwBusy) return;
    if (!cur) return setPwMsg({ text: "현재 비밀번호를 입력해 주세요.", err: true });
    if (pw.length < 8) return setPwMsg({ text: "비밀번호는 8자 이상으로 정해 주세요.", err: true });
    if (/^\d+$/.test(pw)) return setPwMsg({ text: "숫자만으로는 안 돼요. 영문을 섞어 주세요.", err: true });
    if (pw !== pw2) return setPwMsg({ text: "두 비밀번호가 서로 달라요.", err: true });
    setPwBusy(true);
    setPwMsg(null);
    try {
      const r = await fetch("/api/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current: cur, password: pw }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setPwMsg({ text: d?.error || "비밀번호를 바꾸지 못했어요.", err: true });
      else {
        setCur("");
        setPw("");
        setPw2("");
        setPwMsg({ text: "비밀번호를 바꿨어요. 다음 로그인부터 새 비밀번호를 쓰세요.", err: false });
      }
    } catch {
      setPwMsg({ text: "네트워크 오류로 바꾸지 못했어요.", err: true });
    } finally {
      setPwBusy(false);
    }
  }

  const note = (m: Note) =>
    m && (
      <p role={m.err ? "alert" : undefined} className={`text-[13px] ${m.err ? "" : "text-blue"}`} style={m.err ? { color: "var(--red)" } : undefined}>
        {m.text}
      </p>
    );

  const LABEL = "flex flex-col gap-2 text-[13px] font-semibold";
  const mismatch = pw2 !== "" && pw !== pw2;

  return (
    <main className="flex-1 w-full max-w-lg mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center">
        <BackButton fallback="/my" />
      </header>
      <section className="rise px-1 pb-1">
        <h1 className="text-[24px] lg:text-[28px] font-bold mb-1.5">내 정보 수정</h1>
        <p className="text-sub text-[15px]">아이디 {loginId}</p>
      </section>

      <section className="rise d1 card p-5 flex flex-col gap-3.5">
        <h2 className="font-bold text-[17px]">이름</h2>
        {!loaded ? (
          <div className="skel h-12 !rounded-[12px]" />
        ) : (
          <label className={LABEL} style={{ color: "var(--sub-2)" }}>
            선생님께 보이는 이름
            <input
              className="field text-[16px] font-normal text-text"
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
            />
          </label>
        )}
        {note(msg)}
        <button onClick={saveName} disabled={busy || !loaded} className="btn btn-primary h-12 text-[15px]">
          {busy ? "저장 중…" : "이름 저장"}
        </button>
      </section>

      <section className="rise d2 card p-5 flex flex-col gap-3.5">
        <h2 className="font-bold text-[17px]">비밀번호 변경</h2>
        <label className={LABEL} style={{ color: "var(--sub-2)" }}>
          현재 비밀번호
          <input className="field text-[16px] font-normal text-text" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </label>
        <label className={LABEL} style={{ color: "var(--sub-2)" }}>
          새 비밀번호
          <input
            className="field text-[16px] font-normal text-text"
            type="password"
            autoComplete="new-password"
            placeholder="8자 이상, 영문 포함"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className={LABEL} style={{ color: "var(--sub-2)" }}>
          새 비밀번호 확인
          <input
            className="field text-[16px] font-normal text-text"
            type="password"
            autoComplete="new-password"
            placeholder="한 번 더 입력"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && changePassword()}
            style={mismatch ? { borderColor: "var(--red)" } : undefined}
          />
          {mismatch && <span style={{ color: "var(--red)" }}>비밀번호가 서로 달라요</span>}
        </label>
        {note(pwMsg)}
        <button onClick={changePassword} disabled={pwBusy} className="btn btn-primary h-12 text-[15px]">
          {pwBusy ? "바꾸는 중…" : "비밀번호 바꾸기"}
        </button>
        {isIdAccount && (
          <p className="text-sub text-[13px] leading-relaxed break-keep">
            아이디로 가입한 계정은 비밀번호 찾기 메일을 받을 수 없어요. 잊어버리면 선생님께 초기화를 부탁하세요.
          </p>
        )}
      </section>
    </main>
  );
}
