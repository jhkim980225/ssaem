-- 문제은행 (기출문제). Supabase SQL Editor에 통째로 붙여넣어 실행.
-- 전부 idempotent — 여러 번 실행해도 안전합니다.
--
-- 강사 출제 퀴즈(quiz_questions/quiz_attempts)와 별개인 **전역 공용** 문제은행이다.
-- 학원·강사에 종속되지 않는다 (teacher_id 없음). 소스: C:\dev\acct_quiz 파이프라인 산출물.
-- 컬럼명은 소스 스키마와 맞춰 파이프라인 재적재를 호환한다.
--
-- ⚠️ 이 파일만 실행할 것. schema.sql 전체를 다시 실행하면 20260810000000_lock_client_rls.sql이
--    제거한 옛 클라이언트 정책(profiles_self_write 등)이 재생성돼 권한 상승 구멍이 되돌아온다.
--    실수로 그랬다면 20260810000000_lock_client_rls.sql을 다시 실행해 정책을 걷어낼 것.

-- ─────────────────────────────────────────────
-- ① 문제은행 문항
-- ─────────────────────────────────────────────
create table if not exists bank_questions (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null,                        -- 전산회계1급 | 전산회계2급 | 전산세무2급
  category     text not null,                        -- 이론 | 실무분개 | 결산
  type_tag     text not null default '미분류',
  area         text not null default '재무회계',       -- 재무회계 | 원가회계 | 부가가치세 | 소득세
  stem         text not null unique,                 -- 중복 적재 방지. upsert 충돌 키
  choices      jsonb,                                -- 이론: ["보기1",...4개]. 실무: null
  answer_idx   int check (answer_idx between 0 and 3),  -- 실무: null
  answer_text  text,                                 -- 실무 정답(분개). 이론: null
  explanation  text,
  source       text,                                 -- 예: 전산회계1급 125회
  created_at   timestamptz default now(),
  -- 이론은 4지선다 필수, 실무는 answer_text 필수
  check (
    (choices is not null and answer_idx is not null)
    or answer_text is not null
  )
);
create index if not exists bank_questions_filter_idx on bank_questions (subject, category, area);
create index if not exists bank_questions_tag_idx on bank_questions (subject, type_tag);

-- ─────────────────────────────────────────────
-- ② 풀이 기록 (오답노트 재료)
-- ─────────────────────────────────────────────
-- chosen_idx: 이론(4지선다)만 0~3. 실무 자가채점은 null (선택지가 없다).
-- is_correct: 이론은 서버 채점, 실무는 학생 자가채점.
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

-- ─────────────────────────────────────────────
-- ③ 필터 트리 집계 뷰 (subject × area × category × type_tag 문항수)
-- ─────────────────────────────────────────────
-- PostgREST 1000행 캡 회피 + 문항수 뱃지. 서버(service_role)만 읽는다.
create or replace view bank_tag_counts
with (security_invoker = true) as
select subject, area, category, type_tag, count(*)::int as count
from bank_questions
group by subject, area, category, type_tag;

-- ─────────────────────────────────────────────
-- RLS — 정책 0개 = anon/authenticated 전면 차단, service_role만 통과.
-- 20260810000000_lock_client_rls.sql의 원칙 그대로. 클라이언트는 /api/bank 경유로만 접근.
-- (되돌릴 일이 생겨도 for all 정책은 쓰지 말 것 — 컬럼 제한이 없다.)
-- ─────────────────────────────────────────────
alter table bank_questions enable row level security;
alter table bank_attempts  enable row level security;

drop policy if exists bank_questions_read  on bank_questions;
drop policy if exists bank_questions_write on bank_questions;
drop policy if exists bank_attempts_read   on bank_attempts;
drop policy if exists bank_attempts_write  on bank_attempts;

-- ─────────────────────────────────────────────
-- 확인
-- ─────────────────────────────────────────────
select 'bank_questions' t, count(*) from bank_questions
union all select 'bank_attempts', count(*) from bank_attempts;
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename in ('bank_questions', 'bank_attempts');
select count(*) as bank_policies from pg_policies
where schemaname = 'public' and tablename in ('bank_questions', 'bank_attempts');
