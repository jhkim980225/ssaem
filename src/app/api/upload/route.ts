import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { requireRole } from "@/lib/auth";
import { saveDocument, ownCourseOrNull, lessonDateOrNull, MAX_CONTENT, tooLongMessage } from "@/lib/documents";
import { fileKind, extractOfficeText, ExtractError } from "@/lib/extract";
import { ocrPdf } from "@/lib/ocr";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// 파일(PDF·한글·워드) 업로드 → 텍스트 추출 → 원본 저장 + 청킹 + 임베딩.
export async function POST(req: Request) {
  const gate = await requireRole(req, "teacher");
  if ("res" in gate) return gate.res;
  const uid = gate.uid;

  // 전 라우트 중 유일하게 한도가 없었다. 요청 1건이 15MB 파싱 + 청킹 + 임베딩을 돌리므로
  // 반복 호출만으로 함수 시간·임베딩 비용이 샌다. 본문을 읽기 전에 막는다.
  if (!rateLimit(`upload:${uid}`, 30, 3_600_000))
    return NextResponse.json(
      { error: "업로드가 너무 잦아요. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind") === "style" ? "style" : "problem";
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024)
    return NextResponse.json({ error: "파일은 15MB 이하만 지원해요" }, { status: 413 });

  const buf = new Uint8Array(await file.arrayBuffer());
  // MIME은 브라우저 자기신고(한글 파일은 빈 값인 경우도 많다) — 매직 바이트로 실제 형식 판별
  const type = fileKind(buf);
  if (!type)
    return NextResponse.json(
      { error: "PDF·한글(.hwp/.hwpx)·워드(.docx) 파일만 올릴 수 있어요" },
      { status: 400 }
    );

  let content: string;
  if (type !== "pdf") {
    try {
      content = extractOfficeText(type, buf);
    } catch (e) {
      const msg = e instanceof ExtractError ? e.message : "파일을 읽지 못했어요.";
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (!content)
      return NextResponse.json(
        { error: "파일에서 글자를 찾지 못했어요 (그림으로만 된 문서는 PDF로 저장해 올려 주세요)" },
        { status: 422 }
      );
  } else {
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    content = (Array.isArray(text) ? text.join("\n") : text).trim();

    // 스캔 PDF: 텍스트 레이어 없음 → LLM 비전 OCR 폴백
    if (!content) {
      // OCR은 15MB를 통째로 비전 모델에 밀어넣는다 — 업로드 한도보다 더 좁게 잡는다
      if (!rateLimit(`ocr:${uid}`, 10, 3_600_000))
        return NextResponse.json(
          { error: "스캔 PDF 인식이 너무 잦아요. 잠시 후 다시 시도해 주세요." },
          { status: 429 }
        );
      try {
        content = (await ocrPdf(buf)) ?? "";
      } catch (e) {
        // 프로바이더 응답 원문에는 쿼터·프로젝트 정보가 섞인다 — 로그에만 남긴다
        console.error("ocr:", e instanceof Error ? e.message : e);
        return NextResponse.json(
          { error: "스캔 PDF를 읽지 못했어요. 잠시 후 다시 시도해 주세요." },
          { status: 422 }
        );
      }
      if (!content)
        return NextResponse.json(
          { error: "텍스트 추출 실패 (스캔 PDF — OCR용 API 키 필요)" },
          { status: 422 }
        );
    }
  }

  // 붙여넣기(/api/documents)와 같은 상한 — 파일로 올리면 우회되던 구멍. 추출 후 길이로 잰다.
  if (content.length > MAX_CONTENT)
    return NextResponse.json({ error: tooLongMessage() }, { status: 413 });

  const courseId = await ownCourseOrNull(uid, form?.get("courseId"));
  const lessonDate = lessonDateOrNull(form?.get("lessonDate"));

  try {
    const r = await saveDocument({
      teacherId: uid,
      kind,
      rawText: content,
      title: file.name,
      // 한글·워드는 추출 결과가 평문이라 "text"로 둔다 — 추출이 어긋난 곳을 강사가 바로 고칠 수 있게
      // (documents.source check 제약이 text/pdf뿐이기도 하다)
      source: type === "pdf" ? "pdf" : "text",
      courseId,
      lessonDate,
    });
    return NextResponse.json({ ok: true, chars: content.length, ...r });
  } catch (e) {
    console.error("upload save:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "자료를 저장하지 못했어요." }, { status: 500 });
  }
}
