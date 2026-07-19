-- sstest: 학원 선생님별 RAG 튜터
-- Supabase SQL editor에서 실행.

create extension if not exists vector;

-- 선생님 프로필 (id = auth.users.id)
create table if not exists teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  subject text,
  tone_note text,            -- 말투/톤 지시문 (선생님이 직접 작성)
  created_at timestamptz default now()
);

-- 학습 자료: 문제/풀이/말투샘플
create table if not exists materials (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  kind text not null default 'problem',   -- 'problem' | 'style'
  content text not null,
  embedding vector(1536),                 -- OpenAI text-embedding-3-small
  created_at timestamptz default now()
);

create index if not exists materials_teacher_idx on materials(teacher_id);
create index if not exists materials_embed_idx
  on materials using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 학생 질문/답변 이력 (서버가 service_role로 기록)
create table if not exists qa_logs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references teachers(id) on delete set null,
  student_name text,
  question text not null,
  answer text,
  used_chunks int default 0,
  created_at timestamptz default now()
);
create index if not exists qa_logs_teacher_idx on qa_logs(teacher_id, created_at desc);

-- RLS
alter table teachers enable row level security;
alter table materials enable row level security;
alter table qa_logs enable row level security;

-- 선생님은 본인 학생 로그만 조회
drop policy if exists qa_logs_teacher_read on qa_logs;
create policy qa_logs_teacher_read on qa_logs for select using (auth.uid() = teacher_id);

-- 선생님 목록은 누구나 읽기 (학생이 선택)
drop policy if exists teachers_public_read on teachers;
create policy teachers_public_read on teachers for select using (true);

-- 본인 프로필만 수정
drop policy if exists teachers_self_write on teachers;
create policy teachers_self_write on teachers for all
  using (auth.uid() = id) with check (auth.uid() = id);

-- 자료는 본인 것만 (서버는 service_role로 우회)
drop policy if exists materials_self on materials;
create policy materials_self on materials for all
  using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

-- 유사도 검색 RPC (service_role로 호출)
create or replace function match_materials(
  p_teacher uuid,
  p_query vector(1536),
  p_k int default 5
) returns table (id uuid, content text, kind text, similarity float)
language sql stable as $$
  select m.id, m.content, m.kind,
         1 - (m.embedding <=> p_query) as similarity
  from materials m
  where m.teacher_id = p_teacher and m.embedding is not null
  order by m.embedding <=> p_query
  limit p_k;
$$;
