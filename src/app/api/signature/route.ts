import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { checkSignature, looksBlank } from "@/lib/signature";

// 전자서명 기록.
// POST { kind:'assessment', refId?, image(PNG dataURL) } → 저장
// GET  ?kind=&refId=  → 본인 서명 조회 (남의 서명은 안 준다)
//
// 신원 증명은 로그인 계정이 하고, 서명은 "본인이 응시했다"는 확인·억제·사후 대조용이다.

const KINDS = ["assessment"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;
  // 서명 이미지는 크다 — 계정당 분당 10회면 정상 사용엔 충분하고 스팸은 막힌다
  if (!rateLimit(`signature:${g.uid}`, 10, 60_000))
    return NextResponse.json({ error: "요청이 너무 잦아요. 잠시 후 다시 시도해 주세요." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const kind = (body?.kind ?? "").toString() as Kind;
  if (!KINDS.includes(kind))
    return NextResponse.json({ error: "kind required" }, { status: 400 });

  const rawRef = (body?.refId ?? "").toString();
  const refId = /^[0-9a-f-]{36}$/i.test(rawRef) ? rawRef : null;

  const image = body?.image;
  const check = checkSignature(image);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  if (looksBlank(image as string))
    return NextResponse.json({ error: "서명을 그려 주세요." }, { status: 400 });

  const db = serviceClient();
  const { data, error } = await db
    .from("signatures")
    .insert({
      user_id: g.uid,
      kind,
      ref_id: refId,
      image,
      ip: clientIp(req),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    })
    .select("id, signed_at")
    .single();
  if (error) {
    console.error("signature insert:", error.message);
    return NextResponse.json({ error: "서명을 저장하지 못했어요." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id, signedAt: data.signed_at });
}

export async function GET(req: Request) {
  const g = await requireUser(req);
  if ("res" in g) return g.res;

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "").toString() as Kind;
  const rawRef = (url.searchParams.get("refId") ?? "").trim();

  let q = db_query(g.uid);
  if (KINDS.includes(kind)) q = q.eq("kind", kind);
  if (/^[0-9a-f-]{36}$/i.test(rawRef)) q = q.eq("ref_id", rawRef);

  const { data, error } = await q.order("signed_at", { ascending: false }).limit(20);
  if (error) return NextResponse.json({ error: "불러오지 못했어요." }, { status: 500 });
  return NextResponse.json({ signatures: data ?? [] });
}

// 본인 것만 — 소유권 필터를 한 곳에 모아 빠뜨릴 여지를 없앤다
function db_query(uid: string) {
  return serviceClient().from("signatures").select("id, kind, ref_id, signed_at").eq("user_id", uid);
}
