import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { teacherFromRequest } from "@/lib/auth";
import { saveDocument } from "@/lib/documents";

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

  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  const content = (Array.isArray(text) ? text.join("\n") : text).trim();
  if (!content)
    return NextResponse.json({ error: "텍스트 추출 실패 (스캔 PDF일 수 있음)" }, { status: 422 });

  try {
    const r = await saveDocument({
      teacherId: uid,
      kind,
      rawText: content,
      title: file.name,
      source: "pdf",
    });
    return NextResponse.json({ ok: true, chars: content.length, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "실패" }, { status: 500 });
  }
}
