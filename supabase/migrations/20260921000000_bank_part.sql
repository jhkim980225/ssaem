-- 문항 세부 파트(part).
--
-- 영역(area)은 재무회계·원가회계·부가가치세·소득세처럼 굵게 나뉜다. 한 영역 안에서 다시
-- "근로소득 / 사업소득 / 소득공제·세액공제"처럼 갈라 봐야 수업·복습 단위가 된다.
-- 그 세부 묶음을 part에 둔다. 값이 없으면 NULL — 화면은 part가 있는 영역에서만 뱃지를 보여준다.
alter table bank_questions add column if not exists part text;

create index if not exists bank_questions_part_idx on bank_questions (subject, area, part);

-- 파트별 문항 수 (문제검색 뱃지용 — PostgREST 1000행 캡을 피하려고 집계 뷰로 둔다)
create or replace view bank_part_counts
with (security_invoker = true) as
select subject, area, category, part, count(*)::int as count
from bank_questions
where part is not null and part <> ''
group by subject, area, category, part;
