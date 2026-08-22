-- 학생 접속(출석) 일별 집계. 접속마다 행을 쌓지 않고 (학생, 날짜)당 카운트만 올린다 —
-- 강사 리포트(누가 몇 번)·학생 출석(며칠째)에 필요한 건 이 롤업이 전부다.
create table if not exists visit_days (
  student_id uuid not null references profiles(id) on delete cascade,
  day date not null,
  count int not null default 1,
  last_at timestamptz not null default now(),
  primary key (student_id, day)
);

create index if not exists visit_days_day_idx on visit_days (day desc);

-- 서버(service role)만 접근 — 클라이언트 직접 접근 차단 (기존 테이블과 동일 정책)
alter table visit_days enable row level security;
