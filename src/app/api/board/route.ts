import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { userWithRole, requireRole } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit, clientIp } from "@/lib/ratelimit";

// 자료 게시판 — RAG 학습 자료와 별개. 강사가 파일·공지를 올리고 학생이 내려받는다.
// POST (강사, multipart): title, body?, courseId?, file? → 게시
// GET  (강사)            : 내 게시물 전체
// GET ?teacher=<id> (학생): 그 강사의 게시물 — 내 ROOM 것 + 공용만. 파일은 1시간 서명 URL
// DELETE ?id= (강사)      : 내 게시물 삭제 (파일도 함께)

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FILE = 20 * 1024 * 1024; // 스토리지 버킷 제한과 동일

export async function POST(req: Request) {
  const g = await requireRole(req, "teacher");
  if ("res" in g) return g.res;
  if (!rateLimit(`board:${clientIp(req)}`, 20, 60_000))
    return NextResponse.json({ error: "too many requests" }, { status: 429 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "form-data가 필요해요" }, { status: 400 });
  const title = (form.get("title") ?? "").toString().trim().slice(0, 200);
  const body = (form.get("body") ?? "").toString().trim().slice(0, 4000) || null;
  const courseIdRaw = (form.get("courseId") ?? "").toString();
  const file = form.get("file");
  if (!title) return NextResponse.json({ error: "제목을 입력해 주세요" }, { status: 400 });

  const db = serviceClient();
  // 강좌는 내 것만 — 남의 강좌 id로 올리는 것 차단 (아니면 공용)
  let courseId: string | null = null;
  if (UUID.test(courseIdRaw)) {
    const { data: c } = await db.from("courses").select("id").eq("id", courseIdRaw).eq("teacher_id", g.uid).maybeSingle();
    if (!c) return NextResponse.json({ error: "내 강좌가 아니에요" }, { status: 400 });
    courseId = c.id;
  }

  let filePath: string | null = null;
  let fileName: string | null = null;
  let fileSize: number | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE) return NextResponse.json({ error: "파일은 20MB까지 올릴 수 있어요" }, { status: 400 });
    fileName = file.name.slice(0, 200) || "파일";
    // 경로에 원본 이름을 넣지 않는다 — 한글·특수문자 키 이슈 방지. 이름은 DB에 따로 저장.
    filePath = `${g.uid}/${crypto.randomUUID()}`;
    const { error: uerr } = await db.storage
      .from("board")
      .upload(filePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "application/octet-stream",
      });
    if (uerr) return NextResponse.json({ error: `파일 업로드 실패: ${uerr.message}` }, { status: 500 });
    fileSize = file.size;
  }

  const { data: post, error } = await db
    .from("board_posts")
    .insert({ teacher_id: g.uid, course_id: courseId, title, body, file_path: filePath, file_name: fileName, file_size: fileSize })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: post.id });
}

type PostRow = {
  id: string;
  course_id: string | null;
  title: string;
  body: string | null;
  file_path: string | null;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
  courses: { title: string } | { title: string }[] | null;
};

async function withUrls(db: ReturnType<typeof serviceClient>, rows: PostRow[]) {
  return Promise.all(
    rows.map(async (p) => {
      let fileUrl: string | null = null;
      if (p.file_path) {
        const { data } = await db.storage.from("board").createSignedUrl(p.file_path, 3600, {
          download: p.file_name ?? true,
        });
        fileUrl = data?.signedUrl ?? null;
      }
      const c = Array.isArray(p.courses) ? p.courses[0] : p.courses;
      return {
        id: p.id,
        courseId: p.course_id,
        course: c?.title ?? null,
        title: p.title,
        body: p.body,
        fileName: p.file_name,
        fileSize: p.file_size,
        fileUrl,
        createdAt: p.created_at,
      };
    })
  );
}

export async function GET(req: Request) {
  const me = await userWithRole(req);
  if (!me) return NextResponse.json({ error: "로그인이 필요해요.", needLogin: true }, { status: 401 });
  const db = serviceClient();
  const teacherParam = new URL(req.url).searchParams.get("teacher");

  // 학생: 그 강사 게시물 중 내 ROOM 것 + 공용
  if (teacherParam) {
    if (!UUID.test(teacherParam)) return NextResponse.json({ error: "teacher required" }, { status: 400 });
    if (!(await sameAcademy(db, me.uid, teacherParam))) return NextResponse.json({ posts: [] });
    let q = db
      .from("board_posts")
      .select("id, course_id, title, body, file_path, file_name, file_size, created_at, courses(title)")
      .eq("teacher_id", teacherParam)
      .order("created_at", { ascending: false })
      .limit(100);
    if (me.role === "student") {
      const { data: enr } = await db
        .from("enrollments")
        .select("course_id, courses!inner(teacher_id)")
        .eq("student_id", me.uid)
        .eq("courses.teacher_id", teacherParam);
      const ids = ((enr ?? []) as { course_id: string }[]).map((e) => e.course_id);
      q = ids.length ? q.or(`course_id.is.null,course_id.in.(${ids.join(",")})`) : q.is("course_id", null);
    }
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ posts: await withUrls(db, (data ?? []) as PostRow[]) });
  }

  // 강사: 내 게시물 전체
  const t = await requireRole(req, "teacher");
  if ("res" in t) return t.res;
  const { data, error } = await db
    .from("board_posts")
    .select("id, course_id, title, body, file_path, file_name, file_size, created_at, courses(title)")
    .eq("teacher_id", t.uid)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: await withUrls(db, (data ?? []) as PostRow[]) });
}

export async function DELETE(req: Request) {
  const g = await requireRole(req, "teacher");
  if ("res" in g) return g.res;
  const id = (new URL(req.url).searchParams.get("id") ?? "").toString();
  if (!UUID.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });

  const db = serviceClient();
  const { data: post } = await db
    .from("board_posts")
    .select("id, file_path")
    .eq("id", id)
    .eq("teacher_id", g.uid)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (post.file_path) await db.storage.from("board").remove([post.file_path]);
  const { error } = await db.from("board_posts").delete().eq("id", id).eq("teacher_id", g.uid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
