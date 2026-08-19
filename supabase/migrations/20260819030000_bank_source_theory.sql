-- 회차별 문항 수를 "이론(4지선다)"만 집계하도록 변경.
-- 이 뷰는 CBT 회차 선택 전용인데 CBT는 이론만 출제한다 — 실무까지 세면
-- "125회 (22문항)"라고 보여주고 실제론 15문제만 나오는 착시가 생긴다.
create or replace view bank_source_counts
with (security_invoker = true) as
select subject, source, count(*)::int as count
from bank_questions
where source is not null and source <> '' and category = '이론'
group by subject, source;
