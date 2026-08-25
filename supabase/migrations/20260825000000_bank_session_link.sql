-- 시험 기록 상세("뭐 틀렸는지")를 위해 문항 시도를 세션에 연결한다.
-- 지금까진 bank_sessions(점수)와 bank_attempts(문항별 정오답)가 따로 놀아서
-- "이 회차에서 무엇을 틀렸나"를 되짚을 방법이 없었다.
alter table bank_attempts
  add column if not exists session_id uuid references bank_sessions(id) on delete set null;

create index if not exists bank_attempts_session_idx on bank_attempts (session_id);

-- 기존 기록 백필 — **CBT 배치 채점분만** 대상.
--
-- CBT는 채점 한 요청 안에서 세션과 시도를 같이 쌓으므로 시각 차이가 ms 단위다.
-- 반면 "한 문제씩" 모드는 문항을 풀 때마다 시도를 남기고 세션은 완주 시점에야 만든다 —
-- 시도가 세션보다 몇 분 앞선다. 창을 넓게 잡으면 그 시도들이 **직전 CBT 세션**으로 빨려 들어가
-- 응시하지도 않은 문항이 그 회차 상세에 섞이고, 정작 자기 세션은 빈 채로 남는다.
-- 그래서 창은 10초로 좁힌다. 여기 안 걸리는 옛 기록은 연결하지 않는 편이 낫다 —
-- 화면이 "문항 기록이 남아 있지 않아요"로 이미 처리한다.
--
-- 한 세션에 total보다 많이 붙는 일도 막는다(창 안에 두 회차가 겹치는 경우의 안전판).
with ranked as (
  select
    a.id as attempt_id,
    s.id as sid,
    s.total,
    row_number() over (
      partition by s.id
      order by abs(extract(epoch from (s.created_at - a.created_at))) asc, a.id
    ) as rn
  from bank_attempts a
  join lateral (
    select s.id, s.total, s.created_at
    from bank_sessions s
    where s.user_id = a.user_id
      and abs(extract(epoch from (s.created_at - a.created_at))) <= 10
    order by abs(extract(epoch from (s.created_at - a.created_at))) asc
    limit 1
  ) s on true
  where a.session_id is null
)
update bank_attempts a
set session_id = ranked.sid
from ranked
where a.id = ranked.attempt_id and ranked.rn <= ranked.total;
