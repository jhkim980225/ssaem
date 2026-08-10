-- 클라이언트(anon/authenticated) 직접 테이블 접근 차단.
--
-- 왜: `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 브라우저에 노출된다. 로그인한 사용자는 자기
-- access_token + anon key로 PostgREST(`/rest/v1/...`)를 직접 호출할 수 있고, 이 경로는
-- 앱 API를 거치지 않아 `requireRole`/`requireUser` 가드가 전혀 적용되지 않는다.
-- 실제로 다음이 가능했다:
--   1) PATCH /rest/v1/profiles?id=eq.<본인> {"role":"admin"}  → 자가 권한 상승
--      (profiles_self_write가 `for all` + `with check (id = auth.uid())`뿐이라 컬럼 제한이 없었음)
--   2) GET /rest/v1/quiz_questions?select=answer,explanation → 정답표 통째 열람
--      (서버는 정답을 일부러 빼고 내려보내는데 RLS가 그걸 무의미하게 만들었음)
--   3) GET /rest/v1/profiles?select=name,role → 같은 학원 전원 실명·uuid·역할 덤프
--   4) PATCH/INSERT /rest/v1/quiz_attempts → 오답노트·강사 리포트 위조
--
-- 이 앱의 서버 라우트는 전부 service_role(RLS 우회)로 DB에 접근하고,
-- 클라이언트 코드는 테이블을 직접 읽거나 쓰는 곳이 한 곳도 없다(`supabase` import는 전부 auth 용도).
-- 따라서 클라이언트용 정책을 전부 제거해도 기능 영향이 없다.
-- RLS는 켜져 있고 정책이 없으면 anon/authenticated는 전면 차단, service_role만 통과한다.
--
-- 되돌릴 일이 생기면(예: 클라이언트에서 직접 읽는 화면을 만들 때) 그 테이블에만
-- SELECT 정책을 좁게 다시 만들 것. `for all`은 쓰지 말 것 — 컬럼 제한이 없다.

drop policy if exists quiz_questions_read       on quiz_questions;
drop policy if exists quiz_questions_owner_write on quiz_questions;
drop policy if exists quiz_attempts_party       on quiz_attempts;
drop policy if exists quiz_attempts_self_write  on quiz_attempts;

drop policy if exists academies_own             on academies;
drop policy if exists profiles_same_academy     on profiles;
drop policy if exists profiles_self_write       on profiles;
drop policy if exists teacher_profiles_read     on teacher_profiles;
drop policy if exists teacher_profiles_self_write on teacher_profiles;
drop policy if exists courses_read              on courses;
drop policy if exists courses_teacher_write     on courses;
drop policy if exists enrollments_visible       on enrollments;
drop policy if exists documents_owner           on documents;
drop policy if exists chunks_owner              on chunks;
drop policy if exists document_events_owner_read on document_events;
drop policy if exists conversations_party       on conversations;
drop policy if exists messages_party            on messages;
drop policy if exists citations_party           on message_citations;
drop policy if exists feedback_party            on message_feedback;

-- RLS가 실제로 켜져 있는지 확인 (정책만 지우고 RLS가 꺼져 있으면 오히려 전면 개방된다)
alter table academies          enable row level security;
alter table profiles           enable row level security;
alter table teacher_profiles   enable row level security;
alter table courses            enable row level security;
alter table enrollments        enable row level security;
alter table documents          enable row level security;
alter table chunks             enable row level security;
alter table document_events    enable row level security;
alter table conversations      enable row level security;
alter table messages           enable row level security;
alter table message_citations  enable row level security;
alter table message_feedback   enable row level security;
alter table quiz_questions     enable row level security;
alter table quiz_attempts      enable row level security;
alter table plan_inquiries     enable row level security;

-- 확인: rowsecurity가 전부 true, 남은 정책 0건이어야 한다
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
select count(*) as remaining_policies from pg_policies where schemaname = 'public';

-- ─────────────────────────────────────────────
-- 검색에서 말투 자료 제외
-- ─────────────────────────────────────────────
-- kind='style'은 "AI가 어떻게 답할지" 적은 강사 내부 지시문이다. 근거로 잡히면
-- 학생 화면 '출처'에 그 지시문이 그대로 보인다. (앱에서도 한 번 더 거르지만 원천에서 막는다.)
create or replace function match_chunks(
  p_teacher uuid,
  p_query vector(1536),
  p_k int default 5,
  p_course uuid default null
) returns table (id uuid, document_id uuid, content text, kind text, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.content, d.kind,
         1 - (c.embedding <=> p_query) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where c.teacher_id = p_teacher
    and c.embedding is not null
    and d.kind <> 'style'
    and (p_course is null or d.course_id is null or d.course_id = p_course)
  order by c.embedding <=> p_query
  limit p_k;
$$;
