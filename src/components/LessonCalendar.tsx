"use client";
import { useState } from "react";

// 강좌 ROOM 수업 달력 — 자료가 있는 날엔 점, 클릭으로 날짜 선택/해제.
// 의존성 0: 월 그리드는 Date 계산 몇 줄이면 충분하다.

export const dateKey = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export default function LessonCalendar({
  marked,
  selected,
  onSelect,
  title,
}: {
  marked: Set<string>; // 자료가 있는 날 ("YYYY-MM-DD")
  selected: string | null;
  onSelect: (d: string | null) => void;
  title?: string; // 있으면 카드 제목 + 우측 월 이동, 없으면 ‹ 월 › 가운데 정렬
}) {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const today = dateKey(now.getFullYear(), now.getMonth(), now.getDate());

  const first = new Date(ym.y, ym.m, 1).getDay(); // 0=일
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const move = (delta: number) => {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  };
  const navBtn = "grid place-items-center w-8 h-8 rounded-[8px] text-sub text-[18px] transition-colors hover:bg-[var(--fill)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        {title && <h2 className="font-bold text-[18px] lg:text-[15px] shrink-0">{title}</h2>}
        <div className={`flex items-center gap-0.5 ${title ? "" : "flex-1 justify-between"}`}>
          <button onClick={() => move(-1)} aria-label="이전 달" className={navBtn}>
            ‹
          </button>
          <p className={`text-[14px] tabular-nums ${title ? "text-sub" : "font-bold"}`}>
            {ym.y}년 {ym.m + 1}월
          </p>
          <button onClick={() => move(1)} aria-label="다음 달" className={navBtn}>
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
          <span key={d} className="text-[12px] text-sub pb-1" style={i === 0 ? { color: "var(--red)" } : undefined}>
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const key = dateKey(ym.y, ym.m, i + 1);
          const on = selected === key;
          const has = marked.has(key);
          return (
            <button
              key={key}
              onClick={() => onSelect(on ? null : key)} // 같은 날 다시 누르면 해제
              className="flex flex-col items-center justify-center gap-0.5 h-10 rounded-[8px] text-[15px] lg:text-[14px] tabular-nums transition-colors hover:bg-[var(--fill)]"
              style={
                on
                  ? { background: "var(--blue)", color: "#fff", fontWeight: 700 }
                  : key === today
                    ? { boxShadow: "inset 0 0 0 1.5px var(--blue)", color: "var(--blue)", fontWeight: 700 }
                    : undefined
              }
            >
              {i + 1}
              {/* 점 자리는 항상 비워 둬 숫자 높이가 날마다 흔들리지 않게 */}
              <span
                className="w-1 h-1 rounded-full"
                style={{ background: has ? (on ? "#fff" : "var(--blue)") : "transparent" }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
