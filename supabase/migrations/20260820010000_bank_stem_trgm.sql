-- 문제검색(ilike '%키워드%')용 trigram 인덱스. 지금(2천 행)은 풀스캔도 빠르지만
-- 문항이 늘어도 검색이 상수 시간에 가깝게 유지되도록 미리 깐다.
create extension if not exists pg_trgm;
create index if not exists bank_questions_stem_trgm
  on bank_questions using gin (stem gin_trgm_ops);
