// 현행 법령을 공용 참고자료로 적재 — 국가법령정보센터 오픈API(law.go.kr).
//
//   npx tsx scripts/import-law.ts                       # 소득세법 + 소득세법 시행령
//   npx tsx scripts/import-law.ts "부가가치세법" "부가가치세법 시행령"
//   LAW_OC=<내 OC> npx tsx scripts/import-law.ts        # 전용 OC(신청 ID)로 호출
//
// 선행: migrations/20260921010000_law_reference.sql (teacher_id NULL 허용 + kind 'law')
//
// 왜 필요한가: 세법은 해마다 바뀌는데 기출 해설·모델 지식은 출제 당시에 멈춰 있다.
// 현행 조문을 검색 근거로 깔아 두면 "지금 기준으로는 얼마인가"에 답할 수 있다.
//
// 저장 방식: 법령 1건 = documents 1행(teacher_id NULL, kind 'law'), 조문을 원문 그대로
// 담는다. 요약하지 않는 이유 — 숫자를 옮겨 적다 틀리면 손해가 더 크고, 출처에 조문
// 번호가 그대로 찍혀 학생이 원문을 확인할 수 있다.
//
// 재실행 안전:
//   - 시행일도 본문도 그대로면 건너뛴다.
//   - 달라졌으면 kind 'law_draft' 문서에 채운 뒤 **다 채운 다음에** 'law'로 바꾸고 옛
//     문서를 지운다. draft는 검색에서 빠지므로, 20분 걸리는 재적재 중에도 학생 답변은
//     옛 조문으로 정상 동작한다 (먼저 지우면 그 시간 동안 근거가 통째로 빈다).
//   - 중간에 끊기면 **이미 들어간 ord를 읽어 빠진 자리만** 채운다. 개수로 세면 앞
//     실행이 아직 살아 있을 때 같은 청크가 두 벌 들어간다 (실제로 38행 중복 발생).
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { embedMany } from "../src/lib/embed";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("❌ .env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const OC = process.env.LAW_OC || "test";
const BASE = "https://www.law.go.kr/DRF";
const UA = "Mozilla/5.0 (ssaem law importer)";
const DEFAULT_LAWS = ["소득세법", "소득세법 시행령"];
// 청크 목표 길이. 짧은 조문은 이 크기까지 이어 붙인다 — 조문 하나당 청크 하나로 끊으면
// 청크가 800개를 넘어 임베딩 분당·일일 한도에 그대로 부딪힌다.
const CHUNK_SIZE = 1600;
// 임베딩 묶음은 **건수가 아니라 글자수**로 자른다. Gemini 무료 티어의 429는 요청
// 건수가 아니라 요청 하나에 담긴 총 토큰에 걸린다 — 실측(1,600자짜리 조문 청크 기준)
// 8건 14,680자 통과 / 10건 18,350자 실패. 300자짜리는 50건(16,500자)도 통과했다.
const EMBED_CHARS = 12_000; // 한 요청 상한(~15,000자)에 여유를 둔 값
const EMBED_GAP_MS = 2_500; // 요청 사이 간격
const EMBED_BACKOFF_MS = 65_000; // 429를 만나면 분당 창이 지나가길 기다린다
const EMBED_RETRIES = 4;

type Clause = { 항번호?: string; 항내용?: string; 호?: Ho | Ho[] };
type Ho = { 호번호?: string; 호내용?: string; 목?: Mok | Mok[] };
type Mok = { 목번호?: string; 목내용?: string | string[] };
type Article = {
  조문번호?: string;
  조문가지번호?: string;
  조문제목?: string;
  조문내용?: string;
  조문여부?: string;
  항?: Clause | Clause[];
};

const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 기본정보 값은 문자열이기도 하고 {content, ...코드} 객체이기도 하다 (법종구분·소관부처)
function metaStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "content" in v) return String((v as { content: unknown }).content ?? "");
  return "";
}

// ─────────────────────────────────────────────
// 본문 정리
// ─────────────────────────────────────────────
// 법령 API 본문은 (1) 표를 <img>로 감싼 괘선 아트로 주고 (2) 조판용 공백이 잔뜩 박혀
// 있다. 그대로 넣으면 임베딩·화면 양쪽에서 쓸모가 없다.
export function clean(raw: string): string {
  let s = raw
    .replace(/<img[^>]*>/g, "") // 여는 태그만 제거 — 안쪽 표 텍스트는 살린다
    .replace(/<\/img>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/ /g, " ");

  // 괘선 표: │ 로 칸이 나뉜 줄만 남기고 ┌─┬┐ 같은 테두리 줄은 버린다.
  // ⚠️ 법령 API는 표를 **줄바꿈 없이 한 줄**로 준다 — 먼저 행을 끊어 놔야 한다.
  //   ① 테두리 구간(┌─┬┐ / ├─┼┤ / └─┴┘)이 행 경계다 → 줄바꿈으로 바꾼다
  //   ② 테두리 없이 이어지는 행(세율표의 "…초과 / …이하")은 `││`가 경계다
  if (/[│├┌└┬┴┼]/.test(s)) {
    s = s
      .replace(/[┌├└][─━┬┼┴┐┤┘]*[┐┤┘]/g, "\n")
      .replace(/│\s*│/g, "│\n│");
    const rows: string[] = [];
    for (const ln of s.split("\n")) {
      if (/^[\s─━┌┐└┘├┤┬┴┼＝=]+$/.test(ln)) continue; // 테두리만 있는 줄
      if (!ln.includes("│")) {
        rows.push(ln);
        continue;
      }
      const cells = ln.split("│").map((c) => c.replace(/\s+/g, " ").trim());
      while (cells.length && cells[0] === "") cells.shift();
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (!cells.length) continue;
      // 한 칸이 두 줄로 조판된 경우(세율표의 "1,400만원 초과 / 5,000만원 이하")는
      // 뒷줄의 나머지 칸이 비어 첫 칸만 남는다 — 앞 행의 첫 칸에 이어 붙인다.
      // 안 합치면 표가 "구간 윗줄 / 아랫줄"로 쪼개져 학생이 구간을 읽을 수 없다.
      const prev = rows[rows.length - 1];
      if (cells.length === 1 && prev?.includes(" | ")) {
        const [head, ...rest] = prev.split(" | ");
        rows[rows.length - 1] = [`${head} ${cells[0]}`, ...rest].join(" | ");
        continue;
      }
      rows.push(cells.join(" | "));
    }
    s = rows.join("\n");
  }

  return s
    .split("\n")
    .map((ln) => ln.replace(/[ \t]{2,}/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// 조문 1개 → 사람이 읽는 텍스트 (항 ① → 호 1. → 목 가.)
function articleText(a: Article): string {
  const lines: string[] = [];
  const head = clean(a.조문내용 ?? "");
  if (head) lines.push(head);
  for (const h of arr(a.항)) {
    const t = clean(h.항내용 ?? "");
    if (t) lines.push(t);
    for (const ho of arr(h.호)) {
      const ht = clean(ho.호내용 ?? "");
      if (ht) lines.push(`  ${ht}`);
      for (const mok of arr(ho.목)) {
        const mt = clean(arr(mok.목내용 as string | string[]).join("\n"));
        if (mt) lines.push(`    ${mt}`);
      }
    }
  }
  return lines.join("\n").trim();
}

// "제55조(세율)" / "제12조의2(비과세소득)"
function articleLabel(law: string, a: Article): string {
  const branch = a.조문가지번호 && a.조문가지번호 !== "0" ? `의${a.조문가지번호}` : "";
  const no = `제${a.조문번호}조${branch}`;
  return a.조문제목 ? `${law} ${no}(${a.조문제목})` : `${law} ${no}`;
}

function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ln of text.split("\n")) {
    if (ln.length > limit) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      for (let i = 0; i < ln.length; i += limit) out.push(ln.slice(i, i + limit));
      continue;
    }
    if (cur && cur.length + 1 + ln.length > limit) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n${ln}` : ln;
  }
  if (cur) out.push(cur);
  return out;
}

// 조문들 → 청크. 조문 머리말 `[소득세법 제55조(세율)]`을 조각마다 붙여 출처를 잃지 않는다.
function buildChunks(lawName: string, articles: Article[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const a of articles) {
    const body = articleText(a);
    if (!body) continue;
    if (/^제\d+조(의\d+)?\s*삭제/.test(body)) continue; // "제3조의2 삭제 <2019.2.12>"
    const label = articleLabel(lawName, a);
    const parts = hardSplit(body, CHUNK_SIZE);
    if (parts.length > 1) {
      // 긴 조문은 단독으로 나눠 담는다 (앞 조문과 섞지 않는다)
      if (cur) {
        out.push(cur);
        cur = "";
      }
      parts.forEach((p, i) => out.push(`[${label}${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}]\n${p}`));
      continue;
    }
    const block = `[${label}]\n${parts[0]}`;
    if (!cur) cur = block;
    else if (cur.length + 2 + block.length <= CHUNK_SIZE) cur += `\n\n${block}`;
    else {
      out.push(cur);
      cur = block;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ─────────────────────────────────────────────
// 법령 API
// ─────────────────────────────────────────────
async function getJson(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`법령 API ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // OC가 막히면 JSON 대신 안내 HTML이 온다 — 원인을 그대로 보여준다
    throw new Error(`법령 API가 JSON이 아닌 응답을 보냈습니다: ${text.slice(0, 200)}`);
  }
}

type LawHit = {
  법령일련번호: string;
  법령명한글: string;
  시행일자: string;
  공포일자: string;
  공포번호: string;
  현행연혁코드: string;
};

async function findLaw(name: string): Promise<LawHit> {
  const q = encodeURIComponent(name);
  const j = await getJson(`lawSearch.do?OC=${OC}&target=law&type=JSON&query=${q}&display=20`);
  const hits = arr((j.LawSearch as { law?: LawHit | LawHit[] } | undefined)?.law);
  // 검색은 부분일치라 "소득세법"에 시행령·시행규칙이 같이 걸린다 — 이름이 정확히 같고
  // 현행인 것만 고른다.
  const exact = hits.filter((h) => h.법령명한글 === name && h.현행연혁코드 === "현행");
  if (!exact.length) throw new Error(`"${name}" 현행 법령을 못 찾음 (검색 결과 ${hits.length}건)`);
  return exact[0];
}

async function fetchArticles(mst: string) {
  const j = await getJson(`lawService.do?OC=${OC}&target=law&type=JSON&MST=${mst}`);
  const law = j["법령"] as {
    기본정보: Record<string, unknown>;
    조문: { 조문단위: Article | Article[] };
  };
  return { meta: law.기본정보, articles: arr(law.조문.조문단위) };
}

// ─────────────────────────────────────────────
// 적재
// ─────────────────────────────────────────────
const ymd = (s: string) => `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}.`;

async function importLaw(name: string) {
  const hit = await findLaw(name);
  const { meta, articles } = await fetchArticles(hit.법령일련번호);
  const lawName = metaStr(meta["법령명_한글"]) || name;
  // 시행일은 검색 결과(현행 기준)를 믿는다 — 기본정보 시행일자는 조문별 시행일이 섞인
  // 법령에서 옛 날짜로 온다 (소득세법: 기본정보 2026.01.01 / 현행 2026.07.01)
  const effective = hit.시행일자 || metaStr(meta["시행일자"]);
  const kindLabel = metaStr(meta["법종구분"]) || "법령";
  const no = metaStr(meta["공포번호"]);
  const title = `${lawName} (${kindLabel} 제${no}호, ${ymd(effective)} 시행)`;

  // 조문만 — '전문'은 편/장/절 머리글이라 근거로 쓸 게 없다
  const real = articles.filter((a) => a.조문여부 === "조문" && a.조문번호);
  const contents = buildChunks(lawName, real);
  if (!contents.length) throw new Error(`${lawName}: 담을 조문이 없습니다`);
  const rawText = [title, "", ...contents].join("\n\n");

  console.log(`\n${title}`);
  console.log(`  조문 ${real.length}개 → 청크 ${contents.length}개 (원문 ${rawText.length.toLocaleString()}자)`);

  // 같은 법령의 기존 문서 찾기. 시행일(title)과 **본문**이 모두 같아야 같은 것이다 —
  // 파서(clean/청킹)를 고치면 시행일이 같아도 내용이 달라지는데, 개수만 보고 "이미
  // 적재됨"으로 넘기면 옛 텍스트가 그대로 남는다.
  const { data: prev } = await db
    .from("documents")
    .select("id, title, raw_text, kind")
    .is("teacher_id", null)
    .in("kind", ["law", "law_draft"])
    .like("title", `${lawName} (%`);
  const live = (prev ?? []).find((d) => d.kind === "law" && d.title === title && d.raw_text === rawText);
  if (live) {
    const { count } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", live.id);
    console.log(`  이미 적재됨 (${count}청크) — 건너뜀`);
    return { title, chunks: count ?? 0 };
  }

  // 새로 채울 자리는 draft로 만든다. 법령 하나가 수백 청크라 임베딩 한도에 걸려
  // 20분 넘게 걸리는데, 그동안 옛 문서를 지워 두면 답변 근거가 비는 시간이 생긴다.
  // draft는 검색(match_reference_chunks)에서 빠지고, 다 채운 뒤 갈아끼운다.
  const draft = (prev ?? []).find(
    (d) => d.kind === "law_draft" && d.title === title && d.raw_text === rawText
  );
  let docId = draft?.id;
  if (docId) {
    console.log("  적재 중이던 문서 이어받기");
  } else {
    const { data: doc, error } = await db
      .from("documents")
      .insert({ teacher_id: null, course_id: null, kind: "law_draft", title, source: "text", raw_text: rawText })
      .select("id")
      .single();
    if (error || !doc) throw new Error(`문서 생성 실패: ${error?.message}`);
    docId = doc.id;
  }

  // 이어받기는 **개수가 아니라 실제로 들어간 ord**로 판단한다. 개수로 세면 앞 실행이
  // 아직 살아 있을 때 같은 청크를 두 벌 넣는다 (실제로 38행 중복 발생).
  const haveOrd = new Set<number>();
  for (let page = 0; ; page += 1000) {
    const { data } = await db
      .from("chunks")
      .select("ord")
      .eq("document_id", docId)
      .order("ord")
      .range(page, page + 999);
    for (const r of (data ?? []) as { ord: number }[]) haveOrd.add(r.ord);
    if (!data || data.length < 1000) break;
  }
  if (haveOrd.size) console.log(`  기존 ${haveOrd.size}/${contents.length}청크 — 빠진 자리만 채운다`);

  // 임베딩 → 적재를 묶음 단위로 번갈아 한다. 한도에 걸려 끊겨도 넣은 데까지는 남고,
  // 다시 실행하면 빠진 자리만 채운다.
  const todo = contents.map((_, k) => k).filter((k) => !haveOrd.has(k));
  let done = haveOrd.size;
  let first = true;
  for (let p = 0; p < todo.length; ) {
    // 글자수 예산만큼 담는다 (한 청크가 예산보다 길어도 최소 1개는 보낸다)
    let q = p;
    let chars = 0;
    while (q < todo.length && (q === p || chars + contents[todo[q]].length <= EMBED_CHARS)) {
      chars += contents[todo[q]].length;
      q++;
    }
    const idx = todo.slice(p, q);
    const slice = idx.map((k) => contents[k]);
    if (!first) await sleep(EMBED_GAP_MS);
    first = false;

    let vecs: (number[] | null)[] | null = null;
    for (let attempt = 1; attempt <= EMBED_RETRIES && !vecs; attempt++) {
      try {
        vecs = await embedMany(slice);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const daily = msg.includes("PerDay");
        if (!msg.includes("429") || daily || attempt === EMBED_RETRIES) {
          if (daily) console.log("\n  일일 한도 소진 — 오늘은 여기까지. 내일 같은 명령으로 이어서 채웁니다.");
          throw e;
        }
        console.log(`\n  한도 — ${EMBED_BACKOFF_MS / 1000}초 쉬고 재시도 (${attempt}/${EMBED_RETRIES - 1})`);
        await sleep(EMBED_BACKOFF_MS);
      }
    }
    if (!vecs) throw new Error("임베딩 실패");

    const rows = idx.map((k, n) => ({
      document_id: docId,
      teacher_id: null,
      ord: k,
      content: contents[k],
      embedding: vecs[n],
    }));
    const { error } = await db.from("chunks").insert(rows);
    if (error) throw new Error(`청크 적재 실패: ${error.message}`);
    done += rows.length;
    p = q;
    process.stdout.write(`\r  적재 ${done}/${contents.length}`);
  }
  console.log("");

  // 다 채운 뒤에 갈아끼운다 — draft → law 로 바꾸고 옛 문서를 지운다.
  // 순서가 중요하다: 먼저 지우면 채우는 20분 동안 근거가 비는 시간이 생긴다.
  const { error: upErr } = await db.from("documents").update({ kind: "law" }).eq("id", docId);
  if (upErr) throw new Error(`문서 전환 실패: ${upErr.message}`);
  const stale = (prev ?? []).filter((d) => d.id !== docId);
  if (stale.length) {
    await db.from("documents").delete().in("id", stale.map((d) => d.id));
    console.log(`  옛 문서 ${stale.length}건 교체 (시행일 또는 본문이 다름)`);
  }
  return { title, chunks: contents.length };
}

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_LAWS;
  console.log(`법령 ${names.length}건 적재 (OC=${OC})`);
  const done: { title: string; chunks: number }[] = [];
  for (const n of names) done.push(await importLaw(n));

  const { count } = await db
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .is("teacher_id", null);
  console.log(`\n✅ 공용 참고자료 청크 총 ${count}개`);
  for (const d of done) console.log(`   ${d.title} — ${d.chunks}청크`);
}

// 직접 실행할 때만 적재한다 — 다른 스크립트가 clean() 같은 걸 import 했다고
// 20분짜리 적재가 시작되면 안 된다.
const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
if (/scripts\/import-law\.ts$/.test(entry)) {
  main().catch((e) => {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    console.error("   (임베딩 분당 한도면 잠시 뒤 같은 명령을 다시 실행하세요 — 이어서 적재합니다)");
    process.exit(1);
  });
}
