-- 미적용 스키마 변경 모음 (Supabase SQL Editor에 통째로 붙여넣어 실행).
-- 전부 idempotent — 여러 번 실행해도 안전합니다.
-- 적용 대상: ① 문제풀이·오답노트 ② 요금제(플랜·도입 문의)

-- ─────────────────────────────────────────────
-- ① 문제풀이 / 오답노트
-- ─────────────────────────────────────────────
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

drop policy if exists quiz_questions_read on quiz_questions;
create policy quiz_questions_read on quiz_questions for select
  using (exists (
    select 1 from profiles p where p.id = quiz_questions.teacher_id and p.academy_id = current_academy()
  ));

drop policy if exists quiz_questions_owner_write on quiz_questions;
create policy quiz_questions_owner_write on quiz_questions for all
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists quiz_attempts_party on quiz_attempts;
create policy quiz_attempts_party on quiz_attempts for select
  using (
    student_id = auth.uid()
    or exists (select 1 from quiz_questions q where q.id = question_id and q.teacher_id = auth.uid())
  );

drop policy if exists quiz_attempts_self_write on quiz_attempts;
create policy quiz_attempts_self_write on quiz_attempts for all
  using (student_id = auth.uid()) with check (student_id = auth.uid());

-- ─────────────────────────────────────────────
-- ② 요금제 (플랜 게이팅 · 도입 문의)
-- ─────────────────────────────────────────────
alter table academies add column if not exists plan text not null default 'free';
do $$ begin
  alter table academies add constraint academies_plan_check check (plan in ('free', 'pro'));
exception when duplicate_object then null;
end $$;

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
-- 정책 없음 = anon/authenticated 전면 차단 (service_role만 접근)

-- ─────────────────────────────────────────────
-- 확인
-- ─────────────────────────────────────────────
select 'quiz_questions' t, count(*) from quiz_questions
union all select 'quiz_attempts', count(*) from quiz_attempts
union all select 'plan_inquiries', count(*) from plan_inquiries;
