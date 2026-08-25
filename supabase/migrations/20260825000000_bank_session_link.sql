-- 시험 기록 상세("뭐 틀렸는지")를 위해 문항 시도를 세션에 연결한다.
-- 지금까진 bank_sessions(점수)와 bank_attempts(문항별 정오답)가 따로 놀아서
-- "이 회차에서 무엇을 틀렸나"를 되짚을 방법이 없었다.
alter table bank_attempts
  add column if not exists session_id uuid references bank_sessions(id) on delete set null;

create index if not exists bank_attempts_session_idx on bank_attempts (session_id);

-- 기존 기록 백필: 채점 시도와 세션 기록은 같은 요청에서 몇 ms 차이로 쌓였다.
-- 같은 사용자의 세션 중 시각이 가장 가까운 것(3분 이내)에 붙인다.
with m as (
  select
    a.id as attempt_id,
    (
      select s.id
      from bank_sessions s
      where s.user_id = a.user_id
        and abs(extract(epoch from (s.created_at - a.created_at))) <= 180
      order by abs(extract(epoch from (s.created_at - a.created_at))) asc
      limit 1
    ) as sid
  from bank_attempts a
  where a.session_id is null
)
update bank_attempts a
set session_id = m.sid
from m
where a.id = m.attempt_id and m.sid is not null;
