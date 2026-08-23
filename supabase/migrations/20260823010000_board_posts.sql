-- 강사 자료 게시판: RAG 학습 자료와 별개로, 학생이 내려받는 파일·공지 게시물.
create table if not exists board_posts (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  course_id uuid references courses(id) on delete set null, -- null = 공용(전체 공개)
  title text not null,
  body text,
  file_path text,  -- storage 'board' 버킷 내 경로 (없으면 글만)
  file_name text,
  file_size int,
  created_at timestamptz not null default now()
);
create index if not exists board_posts_teacher_idx on board_posts (teacher_id, created_at desc);
alter table board_posts enable row level security;
