import { createClient } from "@supabase/supabase-js";

// 빌드/프리렌더 시 env 없어도 import 단계에서 죽지 않게 폴백. 실제 호출은 런타임 값 사용.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

// 브라우저/공개용
export const supabase = createClient(url, anon);

// 서버 전용 (RLS 우회). API 라우트에서만 import.
export function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}
