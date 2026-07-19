-- 학원 AI 튜터 — DB 스키마 v2
-- 설계 근거: docs/db-design.md
-- Supabase SQL editor에서 실행. (v1은 schema.v1.sql — 앱 코드는 아직 v1 참조 중)

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
  action text not null check (action in ('created', 'deleted')),
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
-- 헬퍼: 현재 사용자의 학원
-- ─────────────────────────────────────────────
create or replace function current_academy() returns uuid
language sql stable security definer set search_path = public as $$
  select academy_id from profiles where id = auth.uid();
$$;

-- ─────────────────────────────────────────────
-- RLS — 학원 경계를 넘는 읽기 금지
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

-- 내 학원만 조회
drop policy if exists academies_own on academies;
create policy academies_own on academies for select
  using (id = current_academy());

-- 같은 학원 사용자만 조회 / 본인만 수정
drop policy if exists profiles_same_academy on profiles;
create policy profiles_same_academy on profiles for select
  using (academy_id = current_academy());

drop policy if exists profiles_self_write on profiles;
create policy profiles_self_write on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- 같은 학원 + 공개 강사만 조회 / 본인만 수정
drop policy if exists teacher_profiles_read on teacher_profiles;
create policy teacher_profiles_read on teacher_profiles for select
  using (
    is_public
    and exists (
      select 1 from profiles p
      where p.id = teacher_profiles.id and p.academy_id = current_academy()
    )
  );

drop policy if exists teacher_profiles_self_write on teacher_profiles;
create policy teacher_profiles_self_write on teacher_profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- 강좌: 같은 학원 조회, 담당 강사만 수정
drop policy if exists courses_read on courses;
create policy courses_read on courses for select
  using (academy_id = current_academy());

drop policy if exists courses_teacher_write on courses;
create policy courses_teacher_write on courses for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- 수강: 본인 것 또는 담당 강사
drop policy if exists enrollments_visible on enrollments;
create policy enrollments_visible on enrollments for select
  using (
    student_id = auth.uid()
    or exists (select 1 from courses c where c.id = course_id and c.teacher_id = auth.uid())
  );

-- 자료: 소유 강사 본인만. 학생 직접 접근 차단 (검색은 서버가 service_role로 대행).
drop policy if exists documents_owner on documents;
create policy documents_owner on documents for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists chunks_owner on chunks;
create policy chunks_owner on chunks for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- 감사 로그: 본인 것 읽기만. 위조/삭제 방지 위해 쓰기는 service_role 전용.
drop policy if exists document_events_owner_read on document_events;
create policy document_events_owner_read on document_events for select
  using (teacher_id = auth.uid());

-- 대화: 본인(학생) 또는 대상 강사
drop policy if exists conversations_party on conversations;
create policy conversations_party on conversations for select
  using (student_id = auth.uid() or teacher_id = auth.uid());

drop policy if exists messages_party on messages;
create policy messages_party on messages for select
  using (exists (
    select 1 from conversations c
    where c.id = conversation_id
      and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
  ));

drop policy if exists citations_party on message_citations;
create policy citations_party on message_citations for select
  using (exists (
    select 1 from messages m
    join conversations c on c.id = m.conversation_id
    where m.id = message_id
      and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
  ));

drop policy if exists feedback_party on message_feedback;
create policy feedback_party on message_feedback for all
  using (exists (
    select 1 from messages m
    join conversations c on c.id = m.conversation_id
    where m.id = message_id
      and (c.student_id = auth.uid() or c.teacher_id = auth.uid())
  ));

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
    and (p_course is null or d.course_id is null or d.course_id = p_course)
  order by c.embedding <=> p_query
  limit p_k;
$$;
