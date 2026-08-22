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

  const tile = (label: string, v: number | string, sub?: string) => (
    <div key={label} className="card p-4 text-center">
      <p className="text-[22px] font-extrabold tabular-nums">{v}</p>
      <p className="text-[12px] text-sub mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-sub">{sub}</p>}
    </div>
  );

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-5 py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <h1 className="text-[24px] lg:text-[28px] font-extrabold">개발자 대시보드</h1>
        <p className="text-sub text-[14px]">
          서비스 전반 지표예요. 활성 사용자(DAU·WAU·MAU)는 학생 접속 기록(v0.40.0~) 기준이에요.
        </p>
      </div>

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
      {!m && !err && <div className="skel h-40 !rounded-[20px]" />}

      {m && (
        <>
          <section className="rise d1 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">활성 사용자</h2>
            <div className="grid grid-cols-3 gap-2">
              {tile("DAU (오늘)", m.active.dau)}
              {tile("WAU (7일)", m.active.wau)}
              {tile("MAU (30일)", m.active.mau)}
            </div>
          </section>

          <section className="rise d2 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">일별 접속 (30일)</h2>
            <div className="card p-4">
              <div className="flex items-end gap-[2px] h-24">
                {m.daily.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day} · 접속 ${d.visits}회 · 학생 ${d.students}명`}
                    className="flex-1 rounded-t-[3px] bg-blue min-h-[2px]"
                    style={{ height: `${Math.max(2, (d.visits / maxVisits) * 100)}%`, opacity: d.visits ? 1 : 0.15 }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[11px] text-sub mt-1.5">
                <span>{m.daily[0]?.day.slice(5)}</span>
                <span>{m.daily[m.daily.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
          </section>

          <section className="rise d3 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">가입자</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {tile("총 가입자", m.users.students + m.users.teachers + m.users.admins)}
              {tile("학생", m.users.students)}
              {tile("강사", m.users.teachers)}
              {tile("원장", m.users.admins)}
              {tile("학원", m.users.academies)}
              {tile("신규 가입 (30일)", m.users.newUsers30)}
            </div>
            {/* 일별 신규 가입 30일 */}
            <div className="card p-4">
              <p className="text-[12px] font-bold text-sub mb-2">일별 신규 가입 (30일)</p>
              <div className="flex items-end gap-[2px] h-16">
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
              <div className="flex justify-between text-[11px] text-sub mt-1.5">
                <span>{m.signupDaily[0]?.day.slice(5)}</span>
                <span>{m.signupDaily[m.signupDaily.length - 1]?.day.slice(5)}</span>
              </div>
            </div>
            {/* 학원별 인원 분포 */}
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-[13px] min-w-[420px]">
                <thead>
                  <tr className="text-sub text-[12px] border-b border-line">
                    <th className="text-left font-bold px-4 py-2.5">학원</th>
                    <th className="text-right font-bold px-2 py-2.5">학생</th>
                    <th className="text-right font-bold px-2 py-2.5">강사</th>
                    <th className="text-right font-bold px-2 py-2.5">원장</th>
                    <th className="text-right font-bold px-4 py-2.5">계</th>
                  </tr>
                </thead>
                <tbody>
                  {m.academies.map((a, i) => (
                    <tr key={i} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 font-bold whitespace-nowrap">{a.name}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{a.students}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{a.teachers}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{a.admins}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-bold">{a.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rise d4 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">사용량 (최근 30일)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {tile("새 대화", m.usage30.conversations)}
              {tile("질문", m.usage30.questions)}
              {tile("연습문제 채점", m.usage30.quizAttempts)}
              {tile("기출 채점", m.usage30.bankAttempts)}
              {tile("CBT 응시", m.usage30.cbtSessions)}
            </div>
          </section>

          <section className="rise d5 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">누적</h2>
            <div className="grid grid-cols-2 gap-2">
              {tile("총 대화", m.totals.conversations)}
              {tile("등록 자료", m.totals.documents)}
            </div>
          </section>

          <section className="rise d6 flex flex-col gap-2">
            <h2 className="text-[15px] font-extrabold">사용자별 접속 (학생 전원 · 전 기간)</h2>
            <div className="card p-0 overflow-x-auto">
              <table className="w-full text-[13px] min-w-[560px]">
                <thead>
                  <tr className="text-sub text-[12px] border-b border-line">
                    <th className="text-left font-bold px-4 py-2.5">이름</th>
                    <th className="text-left font-bold px-2 py-2.5">학원</th>
                    <th className="text-right font-bold px-2 py-2.5">총 접속</th>
                    <th className="text-right font-bold px-2 py-2.5">출석일</th>
                    <th className="text-right font-bold px-2 py-2.5">연속</th>
                    <th className="text-right font-bold px-4 py-2.5">최근 접속</th>
                  </tr>
                </thead>
                <tbody>
                  {m.perUser.map((u) => {
                    const maxV = Math.max(1, m.perUser[0]?.visits ?? 1);
                    return (
                      <tr key={u.id} className="border-b border-line last:border-b-0">
                        <td className="px-4 py-2 font-bold whitespace-nowrap">{u.name}</td>
                        <td className="px-2 py-2 text-sub whitespace-nowrap">{u.academy ?? "—"}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          <span className="inline-flex items-center gap-1.5 justify-end">
                            {/* 상대 막대 — 표에서 바로 많이/적게가 보이게 */}
                            <span
                              className="inline-block h-2 rounded-full bg-blue"
                              style={{ width: `${Math.max(2, (u.visits / maxV) * 56)}px`, opacity: u.visits ? 1 : 0.15 }}
                            />
                            {u.visits}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{u.visitDays}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{u.streak > 0 ? `${u.streak}일` : "—"}</td>
                        <td className="px-4 py-2 text-right text-sub whitespace-nowrap">
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
                      <td colSpan={6} className="px-4 py-6 text-center text-sub">
                        아직 접속 기록이 없어요.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-sub">접속은 학생 계정만 집계돼요 (v0.40.0 도입 이후).</p>
          </section>

          <p className="text-[11px] text-sub">
            집계 시각 {new Date(m.generatedAt).toLocaleString("ko-KR")} · 새로고침하면 다시 계산돼요.
          </p>
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

  if (signedInWrongRole)
    return (
      <main className="flex-1 grid place-items-center px-5">
        <div className="text-center">
          <p className="text-[16px] font-bold mb-1">개발자 계정이 아니에요</p>
          <p className="text-sub text-[14px] mb-5">지금 계정을 로그아웃하고 dev 계정으로 다시 로그인해 주세요.</p>
          <button onClick={() => supabase.auth.signOut()} className="btn btn-primary py-3 px-6">
            로그아웃
          </button>
        </div>
      </main>
    );

  return (
    <main className="flex-1 grid place-items-center px-5">
      <div className="card p-6 w-full max-w-sm flex flex-col gap-3">
        <div>
          <h1 className="text-[18px] font-extrabold">개발자 로그인</h1>
          <p className="text-sub text-[13px] mt-0.5">서비스 지표 대시보드 — 개발자 전용이에요.</p>
        </div>
        <input
          className="field"
          placeholder="아이디"
          value={id}
          autoComplete="username"
          onChange={(e) => setId(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="비밀번호"
          value={pw}
          autoComplete="current-password"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
        />
        {err && (
          <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
            {err}
          </p>
        )}
        <button onClick={submit} disabled={busy || !pw} className="btn btn-primary py-3 disabled:opacity-50">
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </div>
    </main>
  );
}
