-- 중복 키를 stem 단독 → (source, stem)으로 변경.
-- 기출은 같은 문제가 여러 회차에 재출제된다. stem 단독 unique면 재출제 문제가
-- 첫 회차에만 남아 회차별 CBT가 완주 불가 (예: 125회 이론 14개 중 3개가 122·119·112회에 흡수).
-- nulls not distinct: source가 null인 행끼리도 같은 stem이면 중복으로 본다 (기존 동작 보존).
-- 규칙 문서: docs/문제은행-적재-규칙.md
alter table bank_questions drop constraint if exists bank_questions_stem_key;
alter table bank_questions drop constraint if exists bank_questions_source_stem_key;
alter table bank_questions
  add constraint bank_questions_source_stem_key unique nulls not distinct (source, stem);
