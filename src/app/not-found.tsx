import Link from "next/link";
import { StateScreen } from "@/components/RoleGuard";

// 404 — 없는 주소로 들어왔을 때 (오타 링크, 지워진 강좌 등)
export default function NotFound() {
  return (
    <StateScreen
      icon={
        <p className="text-[64px] leading-none font-bold tabular-nums tracking-[-2px]" style={{ color: "var(--border-strong)" }}>
          404
        </p>
      }
      title="페이지를 찾을 수 없어요"
      actions={
        <Link href="/" className="btn btn-primary w-full h-[50px] text-[17px] grid place-items-center">
          홈으로 가기
        </Link>
      }
    >
      주소가 바뀌었거나 지워진 페이지예요. 링크를 다시 확인해 주세요.
    </StateScreen>
  );
}
