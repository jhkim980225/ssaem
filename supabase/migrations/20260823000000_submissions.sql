-- 과제 제출: 달력 수업 자료(document) × 학생. 재제출은 같은 행 갱신 (문서당 학생 1건).
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, student_id)
);
create index if not exists submissions_document_idx on submissions (document_id);
create index if not exists submissions_student_idx on submissions (student_id);
-- 서버(service role)만 접근 — 다른 테이블과 동일 정책
alter table submissions enable row level security;
