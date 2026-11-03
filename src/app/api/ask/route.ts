import { NextResponse, after } from "next/server";
import { serviceClient } from "@/lib/supabase";
import { retrieve } from "@/lib/retrieve";
import { generateStream, llmModel, hasLlmKey, type StreamMeta } from "@/lib/anthropic";
import { buildTutorSystem } from "@/lib/prompt";
import { requireUser } from "@/lib/auth";
import { sameAcademy } from "@/lib/tenant";
import { rateLimit } from "@/lib/ratelimit";
import { notify, clip } from "@/lib/notify";

const HISTORY_LIMIT = 10; // 직전 메시지 N개만 맥락으로 (토큰 방어)
const MAX_QUESTION = 2000; // 임베딩·LLM 토큰 폭탄 방어
// 본문 끝 안내(잘림·도중 실패) 앞에 붙이는 보이지 않는 구분자. 헤더는 스트리밍 시작 후
// 못 바꾸니 본문으로 보낸다. ChatPanel은 이걸로 안내를 떼어 따로 그리고, 구분자를 모르는
// 옛 클라이언트(캐시된 PWA)에는 안내 문장이 답변 끝에 그냥 글자로 보인다. ChatPanel과 같은 값.
const NOTICE = "\u2063";

export async function POST(req: Request) {
  // 로그인 필수 — 익명 질문은 이력이 안 남고 남용 방어가 IP뿐이라 닫았다
  const gate = await requireUser(req);
  if ("res" in gate) return gate.res;
  const studentId = gate.uid;

  // 계정당 분당 20회 (LLM 비용 방어).
  // IP 기준으로 잡으면 같은 교실에서 30명이 동시에 물을 때 학원 하나가 20건을 나눠 쓴다 —
  // 로그인 필수가 된 뒤로는 uid가 정확한 단위다.
  if (!rateLimit(`ask:${studentId}`, 20, 60_000))
    return NextResponse.json(
      { error: "질문이 너무 잦아요. 잠시 후 다시 시도해 주세요." },
      { status: 429 }
    );

  const body = await req.json().catch(() => null);
  const teacherId = (body?.teacherId ?? "").toString();
  // 강좌 필터 (공용 자료는 항상 포함). uuid 형식 아니면 무시 — RPC/FK 에러 방지
  const rawCourse = (body?.courseId ?? "").toString();
  const courseId = /^[0-9a-f-]{36}$/i.test(rawCourse) ? rawCourse : null;
  const question = (body?.question ?? "").toString().trim();
  let conversationId: string | null = (body?.conversationId ?? null) as string | null;
  // teacherId도 uuid 형식 강제 — 형식 오류가 match_chunks의 uuid 파싱 에러(500)로 새던 것 차단
  if (!/^[0-9a-f-]{36}$/i.test(teacherId) || !question)
    return NextResponse.json({ error: "teacherId, question required" }, { status: 400 });
  if (question.length > MAX_QUESTION)
    return NextResponse.json(
      { error: `질문은 ${MAX_QUESTION}자 이하로 해주세요.` },
      { status: 400 }
    );

  const db = serviceClient();

  // 학원(테넌트) 경계 — 남의 학원 강사 uuid를 넣어 그 강사의 비공개 자료를
  // 답변·근거(X-Sources)로 빼가던 것 차단. 형제 라우트(quiz·popular·related 등)와 동일 게이트.
  // 강사 본인 자가 테스트(uid===teacherId)는 통과한다.
  if (!(await sameAcademy(db, studentId, teacherId)))
    return NextResponse.json({ error: "teacher not found" }, { status: 404 });

  // 수강 경계 — 학생 노출 규칙(enrollment 기준)을 검색에도 적용. 클라이언트 courseId를 믿으면
  // 수강 해지한 학생·API 직접 호출이 다른 반 자료를 근거로 답을 받는다.
  // 강사·원장(자가 테스트·점검)은 기존대로 전체.
  let allowedCourses: string[] | null = null;
  if (studentId !== teacherId) {
    const [{ data: me }, { data: enr }] = await Promise.all([
      db.from("profiles").select("role").eq("id", studentId).maybeSingle(),
      db
        .from("enrollments")
        .select("course_id, courses!inner(teacher_id)")
        .eq("student_id", studentId)
        .eq("courses.teacher_id", teacherId),
    ]);
    if (!["teacher", "admin", "dev"].includes(me?.role ?? "")) {
      allowedCourses = ((enr ?? []) as { course_id: string }[]).map((e) => e.course_id);
      // 화면은 수강 중인 ROOM만 칩으로 보여주니 정상 흐름에선 안 걸린다. 조용히 공용으로
      // 돌리면 "이 강좌 자료에서만 찾아요" 표시와 실제 검색 범위가 어긋난다 — 막고 알린다.
      if (courseId && !allowedCourses.includes(courseId))
        return NextResponse.json({ error: "이 강좌 수강생만 질문할 수 있어요. 새로고침해 주세요." }, { status: 403 });
    }
  }

  // 이어가기 대화 소유권 검증 — 남의 conversationId로 메시지 주입·이력 열람 차단.
  if (conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .select("student_id, teacher_id")
      .eq("id", conversationId)
      .maybeSingle();
    const mine = !!conv && conv.teacher_id === teacherId && conv.student_id === studentId;
    if (!mine) conversationId = null; // 남의 대화면 무시하고 새 대화로 시작
  }

  // 강사 조회 + 청크 검색(질문 임베딩 포함) + 대화 맥락 — 서로 독립이라 병렬
  const [{ data: teacher }, hits, priorRes] = await Promise.all([
    db
      .from("profiles")
      .select("name, teacher_profiles(subject, tone_note)")
      .eq("id", teacherId)
      .eq("role", "teacher")
      .maybeSingle(),
    // 검색 실패(RPC/lexical DB 에러)해도 라우트를 500으로 죽이지 않는다 —
    // 근거 없이(빈 배열) 답변을 이어가는 편이 'Internal Server Error'가 답변 말풍선에
    // 렌더링되는 것보다 낫다.
    retrieve(teacherId, question, 5, courseId, allowedCourses).catch((e) => {
      console.error("retrieve:", e instanceof Error ? e.message : e);
      return [] as Awaited<ReturnType<typeof retrieve>>;
    }),
    conversationId
      ? db
          .from("messages")
          .select("role, content")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: false })
          .limit(HISTORY_LIMIT)
      : Promise.resolve({ data: null }),
  ]);
  if (!teacher) return NextResponse.json({ error: "teacher not found" }, { status: 404 });
  const tp = Array.isArray(teacher.teacher_profiles) ? teacher.teacher_profiles[0] : teacher.teacher_profiles;

  // 강사 알림 — 응답이 끝난 뒤 보낸다(지연·실패 무영향). 강사 본인 자가 테스트는 제외.
  // 학생 이름은 싣지 않는다 — 질문 앞부분만으로 충분하다.
  if (studentId !== teacherId)
    after(() => notify(`[새 질문] ${teacher.name} 선생님 · "${clip(question)}"`));

  const system = buildTutorSystem(
    { name: teacher.name, subject: tp?.subject, tone_note: tp?.tone_note },
    hits
  );

  // ponytail: LLM 키 전무하면 답변 생성 생략, 검색 결과만 반환 (비용 0 체험 모드)
  if (!hasLlmKey()) {
    const preview = hits
      .map((h, i) => `[근거 ${i + 1}] ${h.content.slice(0, 200)}`)
      .join("\n\n");
    return NextResponse.json({
      answer:
        `⚠️ AI 답변 생성 꺼짐 (API 키 미설정).\n관련 자료 ${hits.length}개 검색됨:\n\n` +
        (preview || "관련 자료 없음."),
      used: hits.length,
      conversationId,
    });
  }

  const history: { role: "user" | "assistant"; content: string }[] = [];
  if (priorRes.data) history.push(...(priorRes.data.reverse() as typeof history));

  // 스트리밍 전에 conversation 확보 → 헤더로 ID 전달
  if (!conversationId) {
    const { data: conv } = await db
      .from("conversations")
      .insert({ teacher_id: teacherId, student_id: studentId, course_id: courseId, title: question.slice(0, 60) })
      .select("id")
      .single();
    conversationId = conv?.id ?? null;
  }

  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let answer = "";
      // 클라이언트가 중간에 끊어도(탭 닫기) throw로 이력 저장까지 죽지 않게 가드
      const push = (t: string) => {
        try {
          controller.enqueue(encoder.encode(t));
        } catch {}
      };
      const meta: StreamMeta = {};
      try {
        for await (const delta of generateStream(
          system,
          [...history, { role: "user", content: question }],
          undefined,
          meta
        )) {
          answer += delta;
          push(delta);
        }
        // max_tokens에서 잘림 — 표시가 없으면 학생은 답이 원래 거기까지인 줄 안다
        if (meta.truncated)
          push(`${NOTICE}\n\n답변이 길어 중간에 끊겼어요 — '이어서'라고 보내면 계속 설명해요.`);
      } catch (e) {
        const raw = e instanceof Error ? e.message : "unknown";
        // 프로바이더 에러 원문(영문·내부 정보)은 학생에게 보이지 않는다 — 다시 시도 안내만
        const msg = /429|quota|rate|RESOURCE_EXHAUSTED/i.test(raw)
          ? "⚠️ 지금 질문이 몰려 있어요. 잠시 후(1분 정도) 다시 시도해 주세요."
          : "⚠️ 답변을 만들지 못했어요. 잠시 후 다시 질문해 주세요.";
        push(answer ? `${NOTICE}\n\n답변 도중 끊겼어요. 잠시 후 다시 질문해 주세요.` : msg);
        console.error("generate:", raw);
      }
      try {
        controller.close();
      } catch {}

      // 이력 기록 (실패해도 답변엔 영향 없음)
      try {
        if (!conversationId || !answer) return;
        await db.from("messages").insert({ conversation_id: conversationId, role: "user", content: question });
        const { data: am } = await db
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: answer,
            model: llmModel(),
            latency_ms: Date.now() - started,
          })
          .select("id")
          .single();
        if (am && hits.length) {
          await db.from("message_citations").insert(
            hits.map((h) => ({ message_id: am.id, chunk_id: h.id, similarity: h.similarity ?? null }))
          );
        }
      } catch (e) {
        console.error("history write:", e instanceof Error ? e.message : e);
      }
    },
  });

  // 근거 미리보기 — 스트리밍 중 헤더 변경 불가하므로 시작 전에 실어 보냄 (한글 → URI 인코딩)
  const sources = encodeURIComponent(
    JSON.stringify(hits.map((h) => ({ kind: h.kind, preview: h.content.slice(0, 60) })))
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(conversationId ? { "X-Conversation-Id": conversationId } : {}),
      "X-Sources": sources,
    },
  });
}
