import { createSign } from "node:crypto";
import { CSV_HEADER, kstStamp, type ResultRow } from "./results-csv";

// 구글시트 전송 격리 모듈. 다른 스프레드시트로 바꾸려면 이 파일만 고친다.
//
// ⚠️ 라이브러리를 안 쓴다: 서비스 계정 인증은 "JWT를 만들어 서명하고 토큰으로 교환"하는 게 전부라
// node:crypto만으로 충분하다 (googleapis SDK는 수십 MB). Gemini를 fetch로 부르는 기존 패턴과 동일.
//
// 필요한 env (없으면 전송을 건너뛴다 — 키 없으면 기능을 낮추는 이 코드베이스 규칙):
//   GOOGLE_SA_EMAIL       서비스 계정 이메일 (xxx@yyy.iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY 서비스 계정 개인키 (PEM. 줄바꿈은 \n 이스케이프 상태로 넣어도 된다)
//   GOOGLE_SHEET_ID       스프레드시트 ID (URL의 /d/<이 부분>/edit)
//   GOOGLE_SHEET_TAB      시트 탭 이름 (기본: 결과)
//
// 셋업: 대상 시트를 GOOGLE_SA_EMAIL에 **편집자**로 공유해야 한다.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export function sheetsConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID
  );
}

function tabName(): string {
  return process.env.GOOGLE_SHEET_TAB || "결과";
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 액세스 토큰 캐시 — 1시간짜리라 매 요청마다 새로 받으면 낭비다 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const email = process.env.GOOGLE_SA_EMAIL!;
  // env에 한 줄로 넣으면 개행이 \n 문자열로 들어온다 — 실제 개행으로 되돌린다
  const key = process.env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, "\n");

  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, exp: iat + 3600, iat })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const jwt = `${header}.${claim}.${b64url(signer.sign(key))}`;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 };
  return d.access_token;
}

/** 결과 한 건 → 시트 한 행 (CSV와 같은 컬럼 순서를 쓴다 — 양식이 갈라지지 않게) */
export function toSheetRow(r: ResultRow): (string | number)[] {
  return [
    kstStamp(r.submittedAt),
    r.academy,
    r.teacher,
    r.assessment,
    r.student,
    r.score,
    r.total,
    r.percent,
    r.signedAt ? kstStamp(r.signedAt) : "없음",
    r.marks,
  ];
}

async function api(path: string, token: string, init?: RequestInit) {
  const id = process.env.GOOGLE_SHEET_ID!;
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
  });
  if (!r.ok) throw new Error(`sheets ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** 시트가 비어 있으면 헤더 행을 먼저 넣는다 (사람이 미리 만들어두지 않아도 되게) */
async function ensureHeader(token: string) {
  const tab = encodeURIComponent(tabName());
  const got = (await api(`/values/${tab}!A1:A1`, token)) as { values?: string[][] };
  if (got.values?.length) return;
  await api(`/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, {
    method: "POST",
    body: JSON.stringify({ values: [[...CSV_HEADER]] }),
  });
}

export type AppendResult = { ok: boolean; skipped?: boolean; error?: string };

/**
 * 결과 행들을 시트 맨 아래에 붙인다.
 *
 * **절대 던지지 않는다** — 시트 전송은 부가 기능이고, 실패해도 응시 결과(DB)는 이미 확정이다.
 * 호출자는 ok=false면 synced=false로 남겨두고 나중에 재전송하면 된다.
 */
export async function appendResultRows(rows: ResultRow[]): Promise<AppendResult> {
  if (!rows.length) return { ok: true };
  if (!sheetsConfigured()) return { ok: false, skipped: true, error: "시트 미설정" };

  try {
    const token = await accessToken();
    await ensureHeader(token);
    const tab = encodeURIComponent(tabName());
    await api(`/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, {
      method: "POST",
      body: JSON.stringify({ values: rows.map(toSheetRow) }),
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("sheets append:", msg);
    return { ok: false, error: msg };
  }
}
