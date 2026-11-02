"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useGate } from "@/components/RoleGuard";
import { avatarEmoji } from "@/lib/avatar";

type Student = {
  id: string;
  name: string;
  questions: number;
  down: number;
  lastQuestion: string;
  lastAt: string;
  visits: number; // 총 접속 수
  visitDays: number; // 출석일수
  lastVisit: string; // 마지막 접속 시각
};

// 학생별 리포트 (Khanmigo 교사 리포트 패턴) — 누가 얼마나 묻는지, 어디서 막히는지.
export default function StudentsPage() {
  const { session, gate, allowed } = useGate("teacher");
  const [days, setDays] = useState(14);
  const [students, setStudents] = useState<Student[] | null>(null);
  // 초기화 결과는 한 번만 내려오므로(저장 안 함) 화면에 띄워두고 강사가 학생에게 전달한다
  const [issued, setIssued] = useState<{ id: string; loginId: string; password: string } | null>(null);
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // 학생 연락처·메모 (개인정보라 펼친 학생만 조회한다 — 목록에 싣지 않는다)
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, { phone: string; note: string }>>({});
  const [detailBusy, setDetailBusy] = useState<string | null>(null);
  const [detailMsg, setDetailMsg] = useState("");

  useEffect(() => {
    if (!allowed || !session) return;
    fetch("/api/students", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => r.json())
      .then((d) => {
        setDays(d.days ?? 14);
        setStudents(d.students ?? []);
      })
      .catch(() => setStudents([]));
  }, [allowed, session]);

  async function resetPw(studentId: string, name: string) {
    if (!allowed || !session) return;
    if (!confirm(`${name} 학생의 비밀번호를 임시 비밀번호로 바꿀까요?
지금 쓰던 비밀번호는 즉시 못 쓰게 돼요.`)) return;
    setBusy(studentId);
    setPwErr("");
    setIssued(null);
    const r = await fetch("/api/students/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ studentId }),
    });
    const d = await r.json().catch(() => null);
    setBusy(null);
    if (!r.ok) return setPwErr(d?.error ?? "초기화하지 못했어요.");
    setIssued({ id: studentId, loginId: d.loginId, password: d.password });
  }

  async function toggleDetail(studentId: string) {
    if (openId === studentId) return setOpenId(null);
    setOpenId(studentId);
    setDetailMsg("");
    if (detail[studentId] || !session) return; // 이미 불러온 학생은 재조회 안 함
    try {
      const r = await fetch(`/api/students/detail?student=${studentId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!r.ok) return;
      const d = await r.json();
      setDetail((p) => ({ ...p, [studentId]: { phone: d.detail?.phone ?? "", note: d.detail?.note ?? "" } }));
    } catch {
      /* 조회 실패는 빈 폼으로 — 입력은 계속 가능 */
    }
  }

  async function saveDetail(studentId: string) {
    if (!session) return;
    const d = detail[studentId] ?? { phone: "", note: "" };
    setDetailBusy(studentId);
    setDetailMsg("");
    try {
      const r = await fetch("/api/students/detail", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ studentId, phone: d.phone, note: d.note }),
      });
      const rd = await r.json().catch(() => null);
      setDetailMsg(r.ok ? "저장했어요." : rd?.error ?? "저장하지 못했어요.");
    } catch {
      setDetailMsg("저장하지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setDetailBusy(null);
    }
  }

  if (gate) return gate;

  const LABEL = "flex flex-col gap-1.5 text-[13px] font-semibold";

  return (
    <main className="flex-1 w-full max-w-lg lg:max-w-[1180px] mx-auto px-4 sm:px-5 lg:px-8 py-6 lg:py-8 flex flex-col gap-4">
      <div className="rise flex flex-col gap-1">
        <Link href="/teacher" className="text-sub text-[14px] font-semibold lg:hidden">
          ← 대시보드
        </Link>
        <h1 className="text-[24px] lg:text-[28px] font-bold">학생별 리포트</h1>
        <p className="text-sub text-[14px] lg:text-[15px]">최근 {days}일, 학생마다 얼마나 묻고 어디서 막혔는지예요.</p>
      </div>

      {pwErr && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {pwErr}
        </p>
      )}

      {students === null && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-20 !rounded-[16px]" />
          ))}
        </div>
      )}

      {students?.length === 0 && (
        <div className="rise d1 card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">아직 로그인한 학생의 질문이 없어요</p>
          <p className="text-sub text-[13px]">
            학생이 로그인하고 질문하면 여기에 쌓여요. 초대 링크를 공유해 보세요.
          </p>
        </div>
      )}

      {/* PC는 카드 2열 — 한 줄에 하나씩 흘리면 넓은 화면에서 스크롤만 길어진다.
          items-start: 한 카드에서 연락처·메모를 펼쳐도 같은 행의 다른 카드가 늘어나지 않게 */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        {students?.map((s, i) => (
          <article key={s.id} className={`rise d${Math.min(i + 1, 6)} card p-5 min-w-0`}>
            <div className="flex items-start gap-3">
              <span className="avatar !w-11 !h-11 !text-[16px]">{avatarEmoji(s.name)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] lg:text-[17px] font-bold truncate">{s.name}</p>
                <p className="text-[13px] text-sub tabular-nums mt-0.5">
                  접속 {s.visits}회 · 출석 {s.visitDays}일
                  {s.lastVisit
                    ? ` · 마지막 ${new Date(s.lastVisit).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}`
                    : " · 접속 기록 없음"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[15px] font-bold tabular-nums">질문 {s.questions}</p>
                {s.down > 0 && (
                  <p className="text-[13px] font-bold mt-0.5" style={{ color: "var(--red)" }}>
                    아쉬움 {s.down}
                  </p>
                )}
              </div>
            </div>

            <p className="mt-3.5 rounded-[10px] px-3.5 py-3 text-[14px] break-words" style={{ background: "var(--fill-2)", color: "var(--text-2)" }}>
              <span className="text-sub">최근 질문</span> · {s.lastQuestion || "—"}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => toggleDetail(s.id)}
                aria-expanded={openId === s.id}
                className={`btn h-9 px-3 text-[13px] ${openId === s.id ? "btn-primary" : "btn-gray font-semibold"}`}
              >
                연락처·메모
              </button>
              <button
                onClick={() => resetPw(s.id, s.name)}
                disabled={busy === s.id}
                className="btn btn-gray h-9 px-3 text-[13px] font-semibold disabled:opacity-50"
              >
                {busy === s.id ? "바꾸는 중…" : "비밀번호 초기화"}
              </button>
            </div>

            {openId === s.id && (
              <div className="animate-pop mt-3 rounded-[12px] border border-line p-4 flex flex-col gap-2.5">
                <p className="text-[12px] text-sub">
                  학생 개인정보예요. 필요한 것만 적고, 학원 밖으로 공유하지 마세요.
                </p>
                <label className={LABEL} style={{ color: "var(--sub-2)" }}>
                  연락처
                  <input
                    className="field"
                    type="tel"
                    placeholder="예: 010-1234-5678"
                    maxLength={30}
                    value={detail[s.id]?.phone ?? ""}
                    onChange={(e) =>
                      setDetail((p) => ({ ...p, [s.id]: { phone: e.target.value, note: p[s.id]?.note ?? "" } }))
                    }
                  />
                </label>
                <label className={LABEL} style={{ color: "var(--sub-2)" }}>
                  메모
                  <textarea
                    className="field min-h-20 resize-y"
                    placeholder="특이사항·상담 내용"
                    maxLength={500}
                    value={detail[s.id]?.note ?? ""}
                    onChange={(e) =>
                      setDetail((p) => ({ ...p, [s.id]: { phone: p[s.id]?.phone ?? "", note: e.target.value } }))
                    }
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  {detailMsg && <span className="text-[13px] text-sub">{detailMsg}</span>}
                  <button
                    onClick={() => saveDetail(s.id)}
                    disabled={detailBusy === s.id}
                    className="btn btn-primary h-10 px-5 text-[14px] disabled:opacity-60"
                  >
                    {detailBusy === s.id ? "저장 중…" : "저장"}
                  </button>
                </div>
              </div>
            )}

            {issued?.id === s.id && (
              <div
                className="animate-pop mt-3 rounded-[12px] p-4 text-[14px] leading-relaxed"
                style={{ background: "var(--blue-weak)" }}
              >
                <p className="font-bold text-blue mb-1.5">임시 비밀번호를 학생에게 알려주세요</p>
                <p style={{ color: "var(--text-2)" }}>
                  아이디 <b className="tabular-nums">{issued.loginId}</b>
                  <br />
                  임시 비밀번호 <b className="tabular-nums">{issued.password}</b>
                </p>
                <p className="mt-2 text-sub text-[12px]">
                  이 화면을 벗어나면 다시 볼 수 없어요. 학생이 로그인한 뒤 비밀번호를 바꾸도록 안내해 주세요.
                </p>
              </div>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
