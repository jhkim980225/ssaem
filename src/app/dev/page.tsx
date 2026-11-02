"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { supabase } from "@/lib/supabase";
import { toEmail } from "@/lib/account";

type Metrics = {
  generatedAt: string;
  users: { students: number; teachers: number; admins: number; academies: number; newUsers30: number };
  active: { dau: number; wau: number; mau: number };
  usage30: { conversations: number; questions: number; quizAttempts: number; bankAttempts: number; cbtSessions: number };
  totals: { conversations: number; documents: number };
  daily: { day: string; students: number; visits: number }[];
  signupDaily: { day: string; count: number }[];
  academies: { name: string; students: number; teachers: number; admins: number; total: number }[];
  perUser: {
    id: string;
    name: string;
    academy: string | null;
    visits: number;
    visitDays: number;
    streak: number;
    lastVisit: string | null;
  }[];
};

// 개발자 대시보드 — dev 계정 전용. 서비스 전반 지표(MAU·사용량)를 한 화면에.
export default function DevPage() {
  const { status, session, role } = useAuth();
  const [m, setM] = useState<Metrics | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (status !== "signed-in" || !session) return;
    fetch("/api/dev/metrics", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "불러오지 못했어요.");
        setM(d);
      })
      .catch((e) => setErr(e.message));
  }, [status, session]);

  if (status === "loading" || role === undefined) return <main className="flex-1" />;
  // 개발자 전용 로그인 — /login(학생·강사 탭)으로 보내지 않고 여기서 바로 받는다
  if (status !== "signed-in" || role !== "dev") return <DevLogin signedInWrongRole={status === "signed-in"} />;

  const maxVisits = Math.max(1, ...(m?.daily ?? []).map((d) => d.visits));

  // 큰 숫자 카드 (DAU·WAU·MAU)
  const stat = (label: string, v: number | string) => (
    <div key={label} className="card p-4 lg:p-5">
      <p className="text-[13px] lg:text-[14px] text-sub">{label}</p>
      <p className="mt-1 lg:mt-1.5 text-[24px] lg:text-[30px] font-bold tabular-nums leading-tight">{v}</p>
    </div>
  );
  // 카드 안 작은 타일 (가입자·사용량·누적). hi = 강조(블루그레이)
  const tile = (label: string, v: number | string, hi?: boolean) => (
    <div
      key={label}
      className="rounded-[12px] px-4 py-3.5"
      style={{ background: hi ? "var(--blue-weak)" : "var(--fill-2)" }}
    >
      <p className="text-[13px]" style={{ color: hi ? "var(--blue)" : "var(--sub)" }}>
        {label}
      </p>
      <p className="mt-1 text-[20px] lg:text-[22px] font-bold tabular-nums" style={hi ? { color: "var(--blue)" } : undefined}>
        {typeof v === "number" ? v.toLocaleString() : v}
      </p>
    </div>
  );
  const h2 = "font-bold text-[17px] lg:text-[19px]";
  const th = "text-left text-[13px] font-semibold text-sub px-3 py-2.5 border-b border-line whitespace-nowrap";
  const td = "px-3 py-3 tabular-nums";

  return (
    <main className="flex-1 w-full max-w-[1120px] mx-auto px-4 lg:px-6 py-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <div className="rise flex flex-col lg:flex-row lg:items-end lg:justify-between gap-1 lg:gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] lg:text-[28px] font-bold tracking-[-0.5px]">개발자 대시보드</h1>
          <p className="text-sub text-[14px]">
            서비스 전반 지표예요. 활성 사용자(DAU·WAU·MAU)는 학생 접속 기록(v0.40.0~) 기준이에요.
          </p>
        </div>
        {m && (
          <p className="text-[13px] text-sub shrink-0">
            집계 시각 {new Date(m.generatedAt).toLocaleString("ko-KR")}
          </p>
        )}
      </div>

      {err && (
        <p
          className="rounded-[12px] px-4 py-3 text-[14px] font-bold"
          style={{ background: "var(--red-weak)", color: "var(--red)" }}
        >
          {err}
        </p>
      )}
      {!m && !err && <div className="skel h-40 !rounded-[16px]" />}

      {m && (
        <>
          <section aria-label="활성 사용자" className="rise d1 grid grid-cols-3 gap-2 lg:gap-3">
            {stat("DAU (오늘)", m.active.dau)}
            {stat("WAU (7일)", m.active.wau)}
            {stat("MAU (30일)", m.active.mau)}
          </section>

          <section className="rise d2 card p-5 lg:p-6">
            <h2 className={`${h2} mb-4 lg:mb-5`}>일별 접속 (30일)</h2>
            <div
              className="flex items-end gap-[2px] lg:gap-1 h-[110px] lg:h-[140px]"
              role="img"
              aria-label="최근 30일 일별 접속 막대 그래프"
            >
              {m.daily.map((d, i) => (
                <div
                  key={d.day}
                  title={`${d.day} · 접속 ${d.visits}회 · 학생 ${d.students}명`}
                  className="flex-1 rounded-t-[3px] bg-blue min-h-[2px]"
                  style={{
                    height: `${Math.max(2, (d.visits / maxVisits) * 100)}%`,
                    // 마지막 날(오늘)만 진하게, 접속 0인 날은 거의 투명
                    opacity: !d.visits ? 0.15 : i === m.daily.length - 1 ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[12px] text-sub mt-2">
              <span>{m.daily[0]?.day.slice(5)}</span>
              <span>{m.daily[m.daily.length - 1]?.day.slice(5)}</span>
            </div>
          </section>

          <section className="rise d3 card p-5 lg:p-6 flex flex-col gap-4 lg:gap-5 min-w-0">
            <h2 className={h2}>가입자</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {tile("총 가입자", m.users.students + m.users.teachers + m.users.admins)}
              {tile("학생", m.users.students)}
              {tile("강사", m.users.teachers)}
              {tile("원장", m.users.admins)}
              {tile("학원", m.users.academies)}
              {tile("신규 가입 (30일)", m.users.newUsers30, true)}
            </div>
            {/* 일별 신규 가입 30일 */}
            <div>
              <p className="text-[13px] font-bold text-sub mb-2">일별 신규 가입 (30일)</p>
              <div className="flex items-end gap-[2px] lg:gap-1 h-16">
                {m.signupDaily.map((d) => {
                  const maxS = Math.max(1, ...m.signupDaily.map((x) => x.count));
                  return (
                    <div
                      key={d.day}
                      title={`${d.day} · ${d.count}명`}
                      className="flex-1 rounded-t-[3px] bg-blue min-h-[2px]"
                      style={{ height: `${Math.max(3, (d.count / maxS) * 100)}%`, opacity: d.count ? 1 : 0.15 }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[12px] text-sub mt-2">
                <span>{m.signupDaily[0]?.day.slice(5)}</span>
                <span>{m.signupDaily[m.signupDaily.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
            {/* 학원별 인원 분포 — 좁은 화면에선 이 박스 안에서만 가로 스크롤 */}
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] min-w-[420px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>학원</th>
                    <th className={th}>학생</th>
                    <th className={th}>강사</th>
                    <th className={th}>원장</th>
                    <th className={th}>계</th>
                  </tr>
                </thead>
                <tbody>
                  {m.academies.map((a, i) => (
                    <tr key={i} className="border-b border-line last:border-b-0">
                      <td className={`${td} font-bold whitespace-nowrap`}>{a.name}</td>
                      <td className={td}>{a.students}</td>
                      <td className={td}>{a.teachers}</td>
                      <td className={td}>{a.admins}</td>
                      <td className={`${td} font-bold`}>{a.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rise d4 card p-5 lg:p-6 flex flex-col gap-4">
            <h2 className={h2}>사용량 (최근 30일)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {tile("새 대화", m.usage30.conversations)}
              {tile("질문", m.usage30.questions)}
              {tile("연습문제 채점", m.usage30.quizAttempts)}
              {tile("기출 채점", m.usage30.bankAttempts)}
              {tile("CBT 응시", m.usage30.cbtSessions)}
            </div>
          </section>

          <section className="rise d5 card p-5 lg:p-6 flex flex-col gap-4">
            <h2 className={h2}>누적</h2>
            <div className="grid grid-cols-2 gap-2">
              {tile("총 대화", m.totals.conversations)}
              {tile("등록 자료", m.totals.documents)}
            </div>
          </section>

          <section className="rise d6 card p-5 lg:p-6 flex flex-col gap-3 min-w-0">
            <div>
              <h2 className={h2}>사용자별 접속</h2>
              <p className="text-[13px] text-sub mt-1">
                학생 전원 · 전 기간. 접속은 학생 계정만 집계돼요 (v0.40.0 도입 이후).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] min-w-[560px] border-collapse">
                <thead>
                  <tr>
                    <th className={th}>이름</th>
                    <th className={th}>학원</th>
                    <th className={th}>총 접속</th>
                    <th className={th}>출석일</th>
                    <th className={th}>연속</th>
                    <th className={th}>최근 접속</th>
                  </tr>
                </thead>
                <tbody>
                  {m.perUser.map((u) => {
                    const maxV = Math.max(1, m.perUser[0]?.visits ?? 1);
                    return (
                      <tr key={u.id} className="border-b border-line last:border-b-0">
                        <td className={`${td} font-bold whitespace-nowrap`}>{u.name}</td>
                        <td className={`${td} text-sub whitespace-nowrap`}>{u.academy ?? "—"}</td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-2">
                            {/* 상대 막대 — 표에서 바로 많이/적게가 보이게 */}
                            <span
                              className="inline-block h-1.5 rounded-full bg-blue"
                              style={{ width: `${Math.max(2, (u.visits / maxV) * 80)}px`, opacity: u.visits ? 1 : 0.15 }}
                            />
                            {u.visits}
                          </span>
                        </td>
                        <td className={td}>{u.visitDays}</td>
                        <td className={td}>{u.streak > 0 ? `${u.streak}일` : "—"}</td>
                        <td className={`${td} text-sub whitespace-nowrap`}>
                          {u.lastVisit
                            ? new Date(u.lastVisit).toLocaleString("ko-KR", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "없음"}
                        </td>
                      </tr>
                    );
                  })}
                  {m.perUser.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sub">
                        아직 접속 기록이 없어요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[12px] text-sub">새로고침하면 다시 계산돼요.</p>
        </>
      )}
    </main>
  );
}

// 개발자 로그인 — /dev 전용 폼. 일반 /login(학생·강사 탭)과 분리.
function DevLogin({ signedInWrongRole }: { signedInWrongRole: boolean }) {
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(id || "dev"), password: pw });
    setBusy(false);
    if (error) setErr("아이디 또는 비밀번호가 맞지 않아요.");
    // 성공 시 auth-store가 role을 갱신 → 이 페이지가 대시보드로 다시 렌더된다.
    // dev가 아닌 계정이면 아래 wrongRole 안내로 떨어진다.
  }

  // 딥네이비 카드 — 일반 로그인(흰 카드)과 한눈에 구분되게
  const head = (
    <>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-[9px] grid place-items-center text-[15px] font-bold bg-white/15">마</span>
        <span className="text-[15px] font-bold">개발자</span>
      </div>
      <div className="mt-6 mb-1">
        <h1 className="text-[24px] lg:text-[26px] font-bold tracking-[-0.5px]">개발자 로그인</h1>
        <p className="mt-1.5 text-[15px] text-white/70">서비스 전체 지표는 개발자 계정만 볼 수 있어요.</p>
      </div>
    </>
  );
  const errBox = "rounded-[10px] px-4 py-3.5 text-[14px] font-semibold";

  if (signedInWrongRole)
    return (
      <main className="flex-1 grid place-items-center px-4 py-8">
        <div className="animate-pop w-full max-w-sm rounded-[16px] p-6 flex flex-col gap-4 text-white bg-blue">
          {head}
          <div className={errBox} style={{ background: "var(--red-weak)", color: "var(--red)" }}>
            개발자 계정이 아니에요. 지금 계정을 로그아웃하고 dev 계정으로 다시 로그인해 주세요.
          </div>
          <button onClick={() => supabase.auth.signOut()} className="btn h-[50px] text-[17px] bg-surface text-blue">
            로그아웃
          </button>
        </div>
      </main>
    );

  const label = "flex flex-col gap-2 text-[13px] font-semibold text-white/80";
  return (
    <main className="flex-1 grid place-items-center px-4 py-8">
      <div className="animate-pop w-full max-w-sm rounded-[16px] p-6 flex flex-col gap-4 text-white bg-blue">
        {head}
        <label className={label}>
          아이디
          <input
            className="field text-text"
            value={id}
            autoComplete="username"
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        <label className={label}>
          비밀번호
          <input
            className="field text-text"
            type="password"
            value={pw}
            autoComplete="current-password"
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            }}
          />
        </label>
        {err && (
          <p className={errBox} style={{ background: "var(--red-weak)", color: "var(--red)" }}>
            {err}
          </p>
        )}
        <button
          onClick={submit}
          disabled={busy || !pw}
          className="btn h-[50px] mt-2 text-[17px] bg-surface text-blue disabled:opacity-50"
        >
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </div>
    </main>
  );
}
