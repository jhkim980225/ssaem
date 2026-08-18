-- 회차별 문항 수 집계 뷰 (CBT 모드의 "회차 선택"용).
-- bank_questions.source에 "전산회계1급 125회" 형태로 들어 있다.
-- 뷰로 빼는 이유는 bank_tag_counts와 같다 — PostgREST 1000행 캡을 안 타고 집계만 받는다.
create or replace view bank_source_counts
with (security_invoker = true) as
select subject, source, count(*)::int as count
from bank_questions
where source is not null and source <> ''
group by subject, source;
