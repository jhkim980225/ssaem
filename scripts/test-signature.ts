// 전자서명 검증 로직 셀프체크 (외부 API 키·DB 불필요).
// 실행: npx tsx scripts/test-signature.ts
import { checkSignature, looksBlank, MAX_SIGNATURE_BYTES, MIN_SIGNATURE_BYTES } from "../src/lib/signature";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean, note = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${note ? ` — ${note}` : ""}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${note ? ` — ${note}` : ""}`);
  }
}

// 유효한 PNG dataURL (1x1 투명 PNG)
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
// 실제 서명처럼 충분히 긴 dataURL
const BIG_PNG = "data:image/png;base64," + "A".repeat(4000);

console.log("\n── 형식 검증");
ok("정상 PNG dataURL 통과", checkSignature(BIG_PNG).ok);
ok("빈 값 거부", !checkSignature("").ok);
ok("null 거부", !checkSignature(null).ok);
ok("숫자 거부", !checkSignature(12345).ok);
ok("JPEG dataURL 거부", !checkSignature("data:image/jpeg;base64,AAAA").ok);
ok("SVG dataURL 거부 (스크립트 삽입 차단)", !checkSignature("data:image/svg+xml;base64,AAAA").ok);
ok("http URL 거부", !checkSignature("https://evil.test/x.png").ok);
ok("base64 아닌 문자 거부", !checkSignature("data:image/png;base64,!!!!").ok);
ok(
  "잘린 base64 거부 (길이 4의 배수 아님)",
  !checkSignature("data:image/png;base64," + "A".repeat(4001)).ok
);
ok(
  "상한 초과 거부",
  !checkSignature("data:image/png;base64," + "A".repeat(MAX_SIGNATURE_BYTES)).ok
);

console.log("\n── 빈 서명 판정");
ok("작은 PNG는 빈 서명으로 본다", looksBlank(TINY_PNG), `${TINY_PNG.length}자 < ${MIN_SIGNATURE_BYTES}`);
ok("충분히 큰 PNG는 서명으로 본다", !looksBlank(BIG_PNG), `${BIG_PNG.length}자`);

console.log("\n" + "=".repeat(50));
console.log(`통과 ${pass} · 실패 ${fails.length}`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
