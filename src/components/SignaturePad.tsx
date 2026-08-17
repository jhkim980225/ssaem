"use client";
import { useEffect, useRef, useState } from "react";

// 손글씨 전자서명 패드. 외부 라이브러리 없이 canvas + pointer 이벤트.
// 마우스·터치·펜 모두 pointer 이벤트 하나로 처리된다.
//
// 부모는 onChange로 PNG dataURL을 받는다 (아무것도 안 그렸으면 null).

type Props = {
  onChange: (dataUrl: string | null) => void;
  /** 캔버스 표시 높이(px). 기본 160 */
  height?: number;
  disabled?: boolean;
};

export default function SignaturePad({ onChange, height = 160, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // 캔버스 실제 해상도를 DPR에 맞춘다 — 안 하면 서명이 뭉개진다
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = cv.getBoundingClientRect();
    cv.width = Math.round(rect.width * dpr);
    cv.height = Math.round(rect.height * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // 다크모드에서도 보이도록 현재 텍스트 색을 쓴다
    ctx.strokeStyle = getComputedStyle(cv).color || "#111";
  }, [height]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // 점 하나만 찍어도 흔적이 남게
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
    dirty.current = true;
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!dirty.current) return;
    setHasInk(true);
    emit();
  }

  function emit() {
    const cv = canvasRef.current;
    if (!cv) return;
    onChange(dirty.current ? cv.toDataURL("image/png") : null);
  }

  function clear() {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    // scale이 걸려 있어도 clearRect는 변환 좌표계를 따르므로 CSS 크기 기준으로 지운다
    ctx.clearRect(0, 0, cv.width, cv.height);
    dirty.current = false;
    setHasInk(false);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        style={{ height, touchAction: "none" }}
        className="w-full rounded-[14px] border border-line bg-transparent"
        aria-label="전자서명 입력"
      />
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-sub">
          {hasInk ? "서명이 입력됐어요." : "위 칸에 손가락이나 마우스로 서명해 주세요."}
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="chip !text-[12px] disabled:opacity-40"
        >
          지우기
        </button>
      </div>
    </div>
  );
}
