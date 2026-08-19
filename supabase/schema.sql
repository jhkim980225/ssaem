-- 학원 AI 튜터 — DB 스키마 v2
-- 설계 근거: docs/db-design.md
-- Supabase SQL editor에서 실행. 앱 코드는 v2 기준.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 테넌트
-- ─────────────────────────────────────────────
create table if not exists academies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- 사용자 (auth.users 1:1). 강사·학생·관리자 공통.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  academy_id uuid references academies(id) on delete set null,
  role text not null default 'student' check (role in ('teacher', 'student', 'admin')),
  name text not null,
  -- 초기 비밀번호(휴대폰 뒷자리)를 쓴 계정은 첫 로그인에서 반드시 바꾸게 한다.
  -- 마이그레이션 20260819010000 참조.
  must_change_password boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists profiles_academy_idx on profiles(academy_id, role);

-- 강사 전용 확장
create table if not exists teacher_profiles (
  id uuid primary key references profiles(id) on delete cascade,
  subject text,
  tone_note text,
  is_public boolean not null default true
);

-- ─────────────────────────────────────────────
-- 강좌 / 수강
-- ─────────────────────────────────────────────
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  academy_id uuid not null references academies(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  created_at timestamptz default now()
);
create index if not exists courses_teacher_idx on courses(teacher_id);

create table if not exists enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (course_id, student_id)
);
create index if not exists enrollments_student_idx on enrollments(student_id);

-- ─────────────────────────────────────────────
-- 자료: 원본(documents) / 조각(chunks)
-- ─────────────────────────────────────────────
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,  -- NULL = 강사 전체 공용
  kind text not null default 'problem' check (kind in ('problem', 'style')),
  title text,
  source text not null default 'text' check (source in ('text', 'pdf')),
  raw_text text not null,     -- 재청킹용 원본 보존
  lesson_date date,           -- 강좌 ROOM 달력용 수업 날짜 (NULL = 미지정)
  created_at timestamptz default now()
);
create index if not exists documents_teacher_idx on documents(teacher_id, created_at desc);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,  -- 비정규화: ANN 필터용
  ord int not null default 0,
  content text not null,
  embedding vector(1536),     -- NULL이면 lexical 폴백 대상
  created_at timestamptz default now()
);
create index if not exists chunks_teacher_idx on chunks(teacher_id);
create index if not exists chunks_document_idx on chunks(document_id, ord);
-- HNSW: ivfflat 대비 recall/속도 우수, lists 사전 튜닝 불필요
create index if not exists chunks_embedding_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- 자료 감사 로그: 등록/제거 기록.
-- 문서가 삭제돼도 기록은 남아야 하므로 title/kind/chunks를 비정규화 복제.
create table if not exists document_events (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  document_id uuid references documents(id) on delete set null,  -- 삭제 후 NULL
  action text not null check (action in ('created', 'updated', 'deleted')),
  title text,
  kind text,
  source text,
  chunks int default 0,
  created_at timestamptz default now()
);
create index if not exists document_events_teacher_idx
  on document_events(teacher_id, created_at desc);

-- ─────────────────────────────────────────────
-- 대화
-- ─────────────────────────────────────────────
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid references profiles(id) on delete set null,  -- 비로그인 허용 시 NULL
  course_id uuid references courses(id) on delete set null,
  title text,
  created_at timestamptz default now()
);
create index if not exists conversations_teacher_idx on conversations(teacher_id, created_at desc);
create index if not exists conversations_student_idx on conversations(student_id, created_at desc);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model text,
  latency_ms int,
  created_at timestamptz default now()
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at);

-- 답변 근거 청크 추적
create table if not exists message_citations (
  message_id uuid not null references messages(id) on delete cascade,
  chunk_id uuid not null references chunks(id) on delete cascade,
  similarity float,
  primary key (message_id, chunk_id)
);

create table if not exists message_feedback (
  message_id uuid primary key references messages(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────
-- 플랜/과금 (docs/수익화-플랜.md)
-- ─────────────────────────────────────────────
-- 결제 주체 = 학원. 전환은 운영자가 SQL로 수동 (PG 미연동):
--   update academies set plan = 'pro' where slug = '<slug>';
alter table academies add column if not exists plan text not null default 'free'
  check (plan in ('free', 'pro'));

-- 도입 문의 (공개 폼 → 서버가 service_role로 insert. 조회는 운영자가 Supabase 대시보드에서)
create table if not exists plan_inquiries (
  id uuid primary key default gen_random_uuid(),
  academy_slug text,
  name text not null,
  contact text not null,
  message text,
  status text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz default now()
);
alter table plan_inquiries enable row level security;
-- 정책 없음 = anon/authenticated 접근 전면 차단 (service_role만)

-- ─────────────────────────────────────────────
-- 문제풀이 / 오답노트
-- ─────────────────────────────────────────────
-- 강사가 올린 자료(documents)를 LLM이 객관식으로 정리해 저장.
-- 자료가 지워지면 그 자료로 만든 문제도 함께 사라진다(cascade).
create table if not exists quiz_questions (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  document_id uuid references documents(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,
  question text not null,
  choices jsonb not null,              -- ["보기1","보기2","보기3","보기4"]
  answer int not null check (answer between 0 and 3),
  explanation text,
  created_at timestamptz default now()
);
create index if not exists quiz_questions_teacher_idx on quiz_questions(teacher_id, created_at desc);
create index if not exists quiz_questions_document_idx on quiz_questions(document_id);

-- 학생 풀이 기록. 오답노트 = correct=false인 최신 시도.
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references quiz_questions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  chosen int not null check (chosen between 0 and 3),
  correct boolean not null,
  created_at timestamptz default now()
);
create index if not exists quiz_attempts_student_idx on quiz_attempts(student_id, created_at desc);
create index if not exists quiz_attempts_question_idx on quiz_attempts(question_id);

alter table quiz_questions enable row level security;
alter table quiz_attempts  enable row level security;

-- 클라이언트 정책 없음 = service_role만 통과. 20260810000000_lock_client_rls.sql 참조.
-- (drop만 남긴다 — 옛 정책이 어딘가 남아 있어도 걷어내기 위해.)
drop policy if exists quiz_questions_read on quiz_questions;
drop policy if exists quiz_questions_owner_write on quiz_questions;
drop policy if exists quiz_attempts_party on quiz_attempts;
drop policy if exists quiz_attempts_self_write on quiz_attempts;
-- ─────────────────────────────────────────────
-- 수강평 (학생 → 강사) / 학생 상세정보
-- ─────────────────────────────────────────────
-- 마이그레이션 20260818020000_reviews_student_details.sql 참조.
-- ⚠️ message_feedback(AI 답변 1건 평가)과 다른 개념 — 이건 강사에 대한 평가다.
-- 강사에겐 익명, 원장에겐 실명으로 보인다 (표시 정책은 앱 코드가 강제).
create table if not exists course_reviews (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (teacher_id, student_id)
);
create index if not exists course_reviews_teacher_idx on course_reviews(teacher_id, created_at desc);
create index if not exists course_reviews_student_idx on course_reviews(student_id);

-- 개인정보는 profiles와 분리한다 — profiles는 여러 경로에서 select되므로
-- 같은 행에 두면 실수로 흘러나갈 여지가 크다. 별도 테이블이면 의도적 join만 조회된다.
create table if not exists student_details (
  student_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  note text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz default now()
);

alter table course_reviews  enable row level security;
alter table student_details enable row level security;
drop policy if exists course_reviews_read   on course_reviews;
drop policy if exists course_reviews_self   on course_reviews;
drop policy if exists student_details_read  on student_details;
drop policy if exists student_details_write on student_details;

-- ─────────────────────────────────────────────
-- 평가 세트 (강사가 올린 시험 — quiz_*와 분리)
-- ─────────────────────────────────────────────
-- 마이그레이션 20260818010000_assessments.sql 참조.
create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,   -- null = 그 강사 전체 학생
  title text not null,
  created_at timestamptz default now()
);
create index if not exists assessments_teacher_idx on assessments(teacher_id, created_at desc);

create table if not exists assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  ord int not null default 0,
  question text not null,
  choices jsonb not null,
  answer int not null check (answer between 0 and 3),
  explanation text
);
create index if not exists assessment_questions_set_idx on assessment_questions(assessment_id, ord);

create table if not exists assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  score int not null,
  total int not null,
  synced boolean not null default false,       -- 구글시트 전송 여부 (연동은 보류)
  submitted_at timestamptz default now(),
  unique (assessment_id, student_id)           -- 응시 1회 제한
);
create index if not exists assessment_attempts_student_idx
  on assessment_attempts(student_id, submitted_at desc);
create index if not exists assessment_attempts_set_idx on assessment_attempts(assessment_id);

create table if not exists assessment_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references assessment_attempts(id) on delete cascade,
  question_id uuid not null references assessment_questions(id) on delete cascade,
  chosen int not null check (chosen between 0 and 3),
  correct boolean not null
);
create index if not exists assessment_responses_attempt_idx on assessment_responses(attempt_id);

alter table assessments          enable row level security;
alter table assessment_questions enable row level security;
alter table assessment_attempts  enable row level security;
alter table assessment_responses enable row level security;
drop policy if exists assessments_read          on assessments;
drop policy if exists assessment_questions_read on assessment_questions;
drop policy if exists assessment_attempts_self  on assessment_attempts;
drop policy if exists assessment_responses_self on assessment_responses;

-- ─────────────────────────────────────────────
-- 전자서명 (평가 응시 본인 확인)
-- ─────────────────────────────────────────────
-- 범용 설계(kind + ref_id). 평가 테이블이 아직 없어 FK는 걸지 않는다 —
-- A(평가 세트) 구현 시 kind별로 앱에서 검증한다. 마이그레이션 20260818000000 참조.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('assessment')),
  ref_id uuid,
  image text not null,               -- PNG dataURL
  signed_at timestamptz default now(),
  ip text,
  user_agent text
);
create index if not exists signatures_user_idx on signatures(user_id, signed_at desc);
create index if not exists signatures_ref_idx on signatures(kind, ref_id);
alter table signatures enable row level security;
drop policy if exists signatures_self on signatures;

-- ─────────────────────────────────────────────
-- 헬퍼: 현재 사용자의 학원
-- ─────────────────────────────────────────────
create or replace function current_academy() returns uuid
language sql stable security definer set search_path = public as $$
  select academy_id from profiles where id = auth.uid();
$$;

-- ─────────────────────────────────────────────
-- RLS — 클라이언트 직접 접근 전면 차단 (정책 0개). 앱은 /api/* 서버가 service_role로 대행.
-- ─────────────────────────────────────────────
alter table academies        enable row level security;
alter table profiles         enable row level security;
alter table teacher_profiles enable row level security;
alter table courses          enable row level security;
alter table enrollments      enable row level security;
alter table documents        enable row level security;
alter table chunks           enable row level security;
alter table document_events  enable row level security;
alter table conversations    enable row level security;
alter table messages         enable row level security;
alter table message_citations enable row level security;
alter table message_feedback enable row level security;

drop policy if exists academies_own on academies;
drop policy if exists profiles_same_academy on profiles;
drop policy if exists profiles_self_write on profiles;
drop policy if exists teacher_profiles_read on teacher_profiles;
drop policy if exists teacher_profiles_self_write on teacher_profiles;
drop policy if exists courses_read on courses;
drop policy if exists courses_teacher_write on courses;
drop policy if exists enrollments_visible on enrollments;
drop policy if exists documents_owner on documents;
drop policy if exists chunks_owner on chunks;
drop policy if exists document_events_owner_read on document_events;
drop policy if exists conversations_party on conversations;
drop policy if exists messages_party on messages;
drop policy if exists citations_party on message_citations;
drop policy if exists feedback_party on message_feedback;
-- ─────────────────────────────────────────────
-- 검색 RPC (service_role로 호출)
-- ─────────────────────────────────────────────
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
    and d.kind <> 'style'   -- 말투 자료는 검색 근거에서 제외 (마이그레이션 20260810과 정렬)
    and (p_course is null or d.course_id is null or d.course_id = p_course)
  order by c.embedding <=> p_query
  limit p_k;
$$;

-- ─────────────────────────────────────────────
-- 문제은행 (기출문제) — 전역 공용. 상세: migrations/20260813000000_question_bank.sql
-- 강사 퀴즈(quiz_*)와 별개. teacher_id 없음. RLS 정책 0개 = service_role 전용.
-- ─────────────────────────────────────────────
create table if not exists bank_questions (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,
  category     text not null,                        -- 이론 | 실무분개 | 결산
  type_tag     text not null default '미분류',
  area         text not null default '재무회계',
  stem         text not null unique,
  choices      jsonb,
  answer_idx   int check (answer_idx between 0 and 3),
  answer_text  text,
  explanation  text,
  source       text,
  created_at   timestamptz default now(),
  check ((choices is not null and answer_idx is not null) or answer_text is not null)
);
create index if not exists bank_questions_filter_idx on bank_questions (subject, category, area);
create index if not exists bank_questions_tag_idx on bank_questions (subject, type_tag);

create table if not exists bank_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  question_id  uuid not null references bank_questions(id) on delete cascade,
  chosen_idx   int check (chosen_idx between 0 and 3),
  is_correct   boolean not null,
  created_at   timestamptz default now()
);
create index if not exists bank_attempts_user_idx on bank_attempts (user_id, created_at desc);
create index if not exists bank_attempts_question_idx on bank_attempts (question_id);

create or replace view bank_tag_counts
with (security_invoker = true) as
select subject, area, category, type_tag, count(*)::int as count
from bank_questions
group by subject, area, category, type_tag;

alter table bank_questions enable row level security;
alter table bank_attempts  enable row level security;

-- 회차별 문항 수 (CBT 모드 회차 선택용). 마이그레이션 20260819000000 참조.
create or replace view bank_source_counts
with (security_invoker = true) as
select subject, source, count(*)::int as count
from bank_questions
where source is not null and source <> ''
group by subject, source;
