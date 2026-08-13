import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { requireRole } from "@/lib/auth";
import { saveDocument, ownCourseOrNull } from "@/lib/documents";
import { ocrPdf } from "@/lib/ocr";
import { serviceClient } from "@/lib/supabase";
import { docLimitError, planForTeacher } from "@/lib/plan";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// PDF 업로드 → 텍스트 추출 → 원본 저장 + 청킹 + 임베딩.
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
    console.error("upload save:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "자료를 저장하지 못했어요." }, { status: 500 });
  }
}
