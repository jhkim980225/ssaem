-- CBT 시험 기록 (세션 단위 점수). 문항 단위는 bank_attempts, 회차 응시 결과는 여기.
create table if not exists bank_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  source text,                    -- null = 랜덤 출제
  total int not null,
  score int not null,
  created_at timestamptz default now()
);
create index if not exists bank_sessions_user_idx on bank_sessions(user_id, created_at desc);
-- 서버(service role) 전용 — anon 직접 접근 차단 (다른 테이블과 동일 패턴)
alter table bank_sessions enable row level security;
