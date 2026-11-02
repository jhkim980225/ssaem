"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { avatarEmoji } from "@/lib/avatar";
import { useGate } from "@/components/RoleGuard";
import BackButton from "@/components/BackButton";

type Teacher = { id: string; name: string; subject: string | null };
type Mine = { teacherId: string; rating: number; comment: string | null };

// 학생이 선생님에게 남기는 수강평. 별점 1~5 + 한 줄 코멘트.
// 선생님 화면에는 **익명**으로 보이고, 원장 화면에만 이름이 함께 보인다 (서버가 분기).
// 선생님당 1건 — 다시 저장하면 수정된다.
export default function MyReviewsPage() {
  const { session, gate } = useGate("student", { loginMessage: "수강평은 계정에 저장돼요." });

  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [mine, setMine] = useState<Record<string, Mine>>({});
  const [draft, setDraft] = useState<Record<string, { rating: number; comment: string }>>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const token = session?.access_token;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [tr, rr] = await Promise.all([
        fetch("/api/teachers", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/reviews", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const td = await tr.json().catch(() => null);
      setTeachers(td?.teachers ?? []);
      const rd = await rr.json().catch(() => null);
      const map: Record<string, Mine> = {};
      for (const m of (rd?.mine ?? []) as Mine[]) map[m.teacherId] = m;
      setMine(map);
    } catch {
      setErr("불러오지 못했어요 — 새로고침해 주세요.");
      setTeachers([]);
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState는 모두 await 이후
    load();
  }, [load]);

  async function save(teacherId: string) {
    const d = draft[teacherId] ?? {
      rating: mine[teacherId]?.rating ?? 0,
      comment: mine[teacherId]?.comment ?? "",
    };
    if (!d.rating) {
      setErr("별점을 골라 주세요.");
      return;
    }
    setBusy(teacherId);
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ teacherId, rating: d.rating, comment: d.comment }),
      });
      const rd = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(rd?.error ?? "저장하지 못했어요.");
        return;
      }
      setMsg("수강평을 남겼어요. 선생님께는 이름 없이 전달돼요.");
      load();
    } catch {
      setErr("저장하지 못했어요 — 네트워크를 확인해 주세요.");
    } finally {
      setBusy("");
    }
  }

  if (gate) return gate;

  return (
    <main className="flex-1 w-full max-w-2xl lg:max-w-4xl mx-auto px-4 pb-8 lg:px-5 lg:py-8 flex flex-col gap-3 lg:gap-4">
      <header className="h-[50px] flex items-center justify-between gap-3">
        <BackButton fallback="/ask" />
        <Link href="/ask" className="chip shrink-0 !text-[13px]">
          질문하기
        </Link>
      </header>
      <section className="rise px-1 pb-1">
        <h1 className="text-[24px] lg:text-[28px] font-bold mb-1.5">선생님 평가</h1>
        <p className="text-sub text-[15px] leading-normal break-keep">
          수업이 어땠는지 알려주세요. <b>선생님께는 이름 없이</b> 전달돼요.
        </p>
      </section>

      {err && (
        <p className="text-[13px] font-bold" style={{ color: "var(--red)" }}>
          {err}
        </p>
      )}
      {msg && (
        <p className="text-[13px] font-bold text-blue">{msg}</p>
      )}

      {teachers === null && <div className="skel h-40 !rounded-[16px]" />}
      {teachers?.length === 0 && (
        <div className="rise card p-10 text-center">
          <p className="text-[15px] font-bold mb-1">평가할 선생님이 없어요</p>
          <p className="text-sub text-[13px]">선생님과 연결되면 여기에 나와요.</p>
        </div>
      )}

      {/* PC에선 강사 카드 2열 — 카드끼리 독립 폼이라 1열일 이유가 없다 */}
      <div className="grid gap-3 lg:gap-4 lg:grid-cols-2 items-start">
      {teachers?.map((t) => {
        const saved = mine[t.id];
        const d = draft[t.id] ?? { rating: saved?.rating ?? 0, comment: saved?.comment ?? "" };
        return (
          <article key={t.id} className="rise card p-5 flex flex-col">
            <div className="flex items-center gap-3 mb-[18px]">
              <span className="grid place-items-center w-11 h-11 shrink-0 rounded-full bg-blue text-white font-bold">
                {avatarEmoji(t.name)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[17px] font-bold truncate">{t.name}</p>
                <p className="text-sub text-[13px]">{t.subject ?? ""}</p>
              </div>
              {saved && (
                <span
                  className="shrink-0 h-[26px] px-2.5 rounded-[8px] text-[12px] font-bold inline-flex items-center text-blue"
                  style={{ background: "var(--blue-weak)" }}
                >
                  평가함
                </span>
              )}
            </div>

            {/* 별점 */}
            <div role="radiogroup" aria-label="별점" className="flex gap-1.5 justify-center mb-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={n === d.rating}
                  onClick={() => setDraft((p) => ({ ...p, [t.id]: { ...d, rating: n } }))}
                  aria-label={`${n}점`}
                  className="grid place-items-center w-11 h-11 transition-transform hover:scale-110"
                  style={{ color: n <= d.rating ? "var(--blue)" : "var(--fill)" }}
                >
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
                  </svg>
                </button>
              ))}
            </div>
            <p className={`text-center text-[14px] mb-4 ${d.rating ? "font-bold text-[var(--sub-2)]" : "text-sub"}`}>
              {d.rating ? `${d.rating}점` : "별점을 골라 주세요"}
            </p>

            <label className="flex flex-col gap-2 text-[13px] font-semibold text-[var(--sub-2)]">
              한 줄 평 (선택)
              <input
                className="field !text-[16px] text-text font-normal"
                placeholder="수업이 어땠나요?"
                maxLength={300}
                value={d.comment}
                onChange={(e) => setDraft((p) => ({ ...p, [t.id]: { ...d, comment: e.target.value } }))}
              />
            </label>

            <button
              onClick={() => save(t.id)}
              disabled={busy === t.id}
              className={`btn ${saved ? "btn-ghost" : "btn-primary"} mt-3.5 h-[52px] text-[16px] disabled:opacity-60`}
            >
              {busy === t.id ? "저장 중…" : saved ? "수정하기" : "평가 남기기"}
            </button>
          </article>
        );
      })}
      </div>
    </main>
  );
}
