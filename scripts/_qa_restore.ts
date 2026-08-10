// 일회용: QA 중 실수로 지운 자료 1건 복구. 실행 후 파일 삭제.
import { serviceClient } from "../src/lib/supabase";
import { saveDocument } from "../src/lib/documents";

const TEXT =
  "거래의 8요소: 차변은 자산의 증가, 부채의 감소, 자본의 감소, 비용의 발생. 대변은 자산의 감소, 부채의 증가, 자본의 증가, 수익의 발생. 분개의 기본이므로 반드시 암기한다.";

const db = serviceClient();

async function main() {


// test 강사 uid 찾기
const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
const u = users.users.find((x) => x.email?.startsWith("test@"));
if (!u) throw new Error("test 계정 없음");
console.log("teacher uid:", u.id, u.email);

const { data: docs } = await db
  .from("documents")
  .select("id, title, course_id")
  .eq("teacher_id", u.id);
console.log("현재 문서 수:", docs?.length);
const already = docs?.find((d) => (d.title ?? "").startsWith("거래의 8요소"));
if (already) {
  console.log("이미 존재 — 복구 불필요");
  return;
}
const sibling = docs?.find((d) => (d.title ?? "").startsWith("시산표는 총계정원장"));
console.log("형제 문서 course_id:", sibling?.course_id);

const r = await saveDocument({
  teacherId: u.id,
  kind: "problem",
  rawText: TEXT,
  source: "text",
  courseId: sibling?.course_id ?? null,
});
console.log("복구 완료:", r);

}
main();
