-- 평가 세트 + 전자서명 — Supabase SQL 에디터에 통째로 붙여넣고 실행하세요.
-- (여러 번 실행해도 안전: 전부 if not exists)

-- 전자서명 기록. 평가 응시 등에서 "본인이 응시했다"는 확인을 남긴다.
--
-- 범용 설계(kind + ref_id): 지금은 평가(assessment)용이지만, 나중에 다른 곳에서도
-- 같은 테이블을 쓴다. ref_id는 대상 행의 id(평가 응시 = assessment_attempts.id).
-- 평가 테이블이 아직 없으므로 FK를 걸지 않는다 — A(평가 세트) 구현 시 kind별로 검증한다.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('assessment')),
  ref_id uuid,
  image text not null,               -- PNG dataURL (data:image/png;base64,...)
  signed_at timestamptz default now(),
  ip text,                           -- 보조 확인 지표 (서명 자체가 신원 증명은 아니므로)
  user_agent text
);
create index if not exists signatures_user_idx on signatures(user_id, signed_at desc);
create index if not exists signatures_ref_idx on signatures(kind, ref_id);

alter table signatures enable row level security;
-- 클라이언트 정책 없음 = service_role만. 접근 제어는 앱 코드(requireUser + 본인 필터).
drop policy if exists signatures_self on signatures;

-- 평가 세트 (강사가 엑셀/CSV로 올린 4지선다 시험).
-- 기존 quiz_*(자료로 LLM이 만든 연습문제)와 분리된 개념 — 이름 붙은 시험 + 1회 응시 + 점수.
-- 설계 근거: docs/superpowers/specs/2026-08-16-평가세트-구글시트-design.md

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
  choices jsonb not null,                      -- ["보기1","보기2","보기3","보기4"]
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
  -- 구글시트 전송 성공 여부. 시트 연동(C)은 보류 상태라 지금은 항상 false로 남는다.
  synced boolean not null default false,
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
-- 클라이언트 정책 없음 = service_role만. 접근 제어는 앱 코드(requireRole·sameAcademy·소유권 필터).
drop policy if exists assessments_read          on assessments;
drop policy if exists assessment_questions_read on assessment_questions;
drop policy if exists assessment_attempts_self  on assessment_attempts;
drop policy if exists assessment_responses_self on assessment_responses;
