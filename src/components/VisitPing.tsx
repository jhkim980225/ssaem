"use client";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-store";

// 학생 접속(출석) 핑 — 앱을 연 세션당 1번만 서버에 기록한다.
// sessionStorage 가드라 탭을 새로 열거나 앱을 다시 켜면 다시 세지고, 페이지 이동은 안 센다.
export default function VisitPing() {
  const { status, session, role } = useAuth();

  useEffect(() => {
    if (status !== "signed-in" || !session || role !== "student") return;
    try {
      if (sessionStorage.getItem("visit-pinged")) return;
      sessionStorage.setItem("visit-pinged", "1");
    } catch {
      return; // 스토리지 막힌 환경(시크릿 등)이면 기록 생략 — 출석은 편의 기능
    }
    fetch("/api/visit", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }, [status, session, role]);

  return null;
}
