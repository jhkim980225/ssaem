import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { teacherFromRequest } from "@/lib/auth";
import { saveDocument, ownCourseOrNull } from "@/lib/documents";
import { ocrPdf } from "@/lib/ocr";
import { serviceClient } from "@/lib/supabase";
import { docLimitError, planForTeacher } from "@/lib/plan";

export const runtime = "nodejs";

// PDF 업로드 → 텍스트 추출 → 원본 저장 + 청킹 + 임베딩.
export async function POST(req: Request) {
  const uid = await teacherFromRequest(req);
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind") === "style" ? "style" : "problem";
  if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (file.type !== "application/pdf")
    return NextResponse.json({ error: "PDF만 지원" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024)
    return NextResponse.json({ error: "PDF는 15MB 이하만 지원해요" }, { status: 413 });

  const limitMsg = await docLimitError(serviceClient(), uid);
  if (limitMsg) return NextResponse.json({ error: limitMsg }, { status: 403 });

  const buf = new Uint8Array(await file.arrayBuffer());
  // MIME은 브라우저 자기신고 — 매직 바이트(%PDF)로 실제 PDF인지 확인
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46))
    return NextResponse.json({ error: "PDF 파일이 아니에요" }, { status: 400 });
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  let content = (Array.isArray(text) ? text.join("\n") : text).trim();

  // 스캔 PDF: 텍스트 레이어 없음 → LLM 비전 OCR 폴백 (Pro 전용 — 비전 API 비용)
  if (!content) {
    const { plan } = await planForTeacher(serviceClient(), uid);
    if (plan !== "pro")
      return NextResponse.json(
        { error: "스캔 PDF는 아직 지원하지 않아요. 텍스트가 들어 있는 PDF로 올려 주세요." },
        { status: 403 }
      );
    try {
      content = (await ocrPdf(buf)) ?? "";
    } catch (e) {
      return NextResponse.json(
        { error: `OCR 실패: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}` },
        { status: 422 }
      );
    }
    if (!content)
      return NextResponse.json(
        { error: "텍스트 추출 실패 (스캔 PDF — OCR용 API 키 필요)" },
        { status: 422 }
      );
  }

  const courseId = await ownCourseOrNull(uid, form?.get("courseId"));

  try {
    const r = await saveDocument({
      teacherId: uid,
      kind,
      rawText: content,
      title: file.name,
      source: "pdf",
      courseId,
    });
    return NextResponse.json({ ok: true, chars: content.length, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패" }, { status: 500 });
  }
}
