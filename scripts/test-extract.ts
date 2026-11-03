// 한글·워드 추출 오프라인 검증. DB·키 불필요. 실행: npx tsx scripts/test-extract.ts [파일...]
// 인자가 없으면 합성 문서 + 아래 기본 샘플(있는 것만)을 검사한다.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert";
import { zipSync, strToU8 } from "fflate";
import { fileKind, extractOfficeText, ExtractError } from "../src/lib/extract";
import { chunkText } from "../src/lib/chunk";

// ── 1. 합성 docx: 문단 + 2×2 표 + 1칸 박스 + 대체본(Fallback) 중복 제거 + 탭 정의 무시 ──
const docxXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="w" xmlns:mc="mc"><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="800"/></w:tabs></w:pPr><w:r><w:t>부가세 &amp; 소득세</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">정리</w:t></w:r></w:p>
<w:p/>
<w:tbl><w:tblPr/><w:tr><w:tc><w:p><w:r><w:t>구분</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>세율</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>일반</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>10%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>박스 첫 줄</w:t></w:r></w:p><w:p><w:r><w:t>박스 둘째 줄</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><mc:AlternateContent><mc:Choice><w:t>상자</w:t></mc:Choice><mc:Fallback><w:t>상자</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>
</w:body></w:document>`;
const docx = zipSync({ "[Content_Types].xml": strToU8("<x/>"), "word/document.xml": strToU8(docxXml) });
assert.equal(fileKind(docx), "docx");
const dt = extractOfficeText("docx", docx);
console.log("── 합성 docx ──\n" + dt + "\n");
assert.equal(
  dt,
  ["부가세 & 소득세\t정리", "구분 | 세율", "일반 | 10%", "박스 첫 줄", "박스 둘째 줄", "상자"].join("\n\n")
);

// ── 2. 합성 hwpx: 표가 문단 안에 들어 있는 구조 + section 순서 ──
const sec = (body: string) =>
  strToU8(`<?xml version="1.0"?><hs:sec xmlns:hs="s" xmlns:hp="p">${body}</hs:sec>`);
const hwpx = zipSync({
  mimetype: strToU8("application/hwp+zip"),
  "Contents/section1.xml": sec(`<hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p>`),
  "Contents/section0.xml": sec(
    `<hp:p><hp:run><hp:t>표 앞<hp:tab width="1"/>글</hp:t><hp:tbl><hp:tr>` +
      `<hp:tc><hp:subList><hp:p><hp:run><hp:t>매출</hp:t></hp:run></hp:p></hp:subList></hp:tc>` +
      `<hp:tc><hp:subList><hp:p><hp:run><hp:t>1,000</hp:t></hp:run></hp:p></hp:subList></hp:tc>` +
      `</hp:tr></hp:tbl></hp:run></hp:p>` +
      `<hp:p><hp:run><hp:t>① 보기<hp:lineBreak/>다음 줄</hp:t></hp:run></hp:p>`
  ),
});
assert.equal(fileKind(hwpx), "hwpx");
const ht = extractOfficeText("hwpx", hwpx);
console.log("── 합성 hwpx ──\n" + ht + "\n");
assert.equal(ht, ["표 앞\t글", "매출 | 1,000", "① 보기\n다음 줄", "둘째 구역"].join("\n\n"));

// ── 3. 판별·거절 ──
assert.equal(fileKind(strToU8("%PDF-1.7")), "pdf");
assert.equal(fileKind(strToU8("hello")), null);
assert.equal(fileKind(zipSync({ "a.txt": strToU8("x") })), null, "docx/hwpx 아닌 zip");
assert.throws(() => extractOfficeText("hwp", strToU8("HWP Document File V3.00 xxxxxxxx")), ExtractError);
assert.throws(() => extractOfficeText("hwp", new Uint8Array(600)), ExtractError);
// 깨진 zip도 강사용 문구로
assert.throws(() => extractOfficeText("docx", docx.subarray(0, 40)), ExtractError);

// ── 4. 실제 샘플 ──
const DEFAULT_DIRS = ["D:\\정리\\1. 수업자료\\회계\\전산세무 2급"];
const DEFAULT_FILES = ["C:\\Users\\jjhhy\\Downloads\\전산세무2급_부가세부속서류_기출모음.docx", "C:\\Users\\jjhhy\\Downloads\\원가회계_답지.docx"];
const args = process.argv.slice(2);
const files = args.length
  ? args
  : [
      ...DEFAULT_DIRS.filter(existsSync).flatMap((d) =>
        readdirSync(d).filter((f) => /\.(hwp|hwpx|docx)$/i.test(f)).map((f) => join(d, f))
      ),
      ...DEFAULT_FILES.filter(existsSync),
    ];
if (!files.length) console.log("(실제 샘플 없음 — 합성 검사만)");

let ok = 0;
for (const f of files) {
  const buf = new Uint8Array(readFileSync(f));
  const kind = fileKind(buf);
  const t0 = Date.now();
  try {
    assert(kind && kind !== "pdf", `판별 실패: ${f}`);
    const text = extractOfficeText(kind, buf);
    const ms = Date.now() - t0;
    const hangul = (text.match(/[가-힣]/g) ?? []).length;
    // 깨진 글자(사용자 정의 영역·대체 문자)·제어문자가 새면 추출이 어긋난 것
    const junk = (text.match(/[\ue000-\uf8ff\ufffd\u0000-\u0008\u000b-\u001f]/g) ?? []).length;
    console.log(
      `── ${kind} ${f.split(/[\\/]/).pop()} — ${text.length.toLocaleString()}자, 한글 ${hangul.toLocaleString()}, ` +
        `잡음 ${junk}, 청크 ${chunkText(text).length}, ${ms}ms ──`
    );
    console.log(text.slice(0, 400).replace(/\n\n/g, "\n") + "\n");
    assert(text.length > 100, "본문이 너무 짧음");
    assert(hangul / text.replace(/\s/g, "").length > 0.3, "한글 비율이 낮음 — 디코딩이 어긋났을 가능성");
    assert(junk === 0, "깨진 글자/제어문자 섞임");
    ok++;
  } catch (e) {
    if (e instanceof ExtractError) console.log(`── ${f}: 거절 — ${e.message}\n`);
    else throw e;
  }
}
console.log(`\n합성 검사 통과 · 실제 샘플 ${ok}/${files.length}건 추출`);
