-- 문제검색이 보기까지 보게 — 검색용 글자 열(search_text).
--
-- 지금까지 /api/bank/search는 stem(지문)만 ilike로 훑었다. 컴활 2과목은 함수가 보기에만 나오는
-- 문항이 많아(예: "VLOOKUP" 10문항 중 9문항이 보기에만) 검색창 예시로 찾아도 1건만 나왔다.
-- 지문 + 보기를 한 열에 이어 붙이고, 화면엔 안 보이는 글 속 그림 토큰([[그림]]URL#폭x높이)은 뺀다
-- — 안 빼면 "png"·"supabase"로 검색해도 문항이 걸린다.
--
-- 생성 열(stored)이라 적재 스크립트(import-bank)는 손댈 것 없다 — 지문·보기가 바뀌면 자동으로 다시 계산된다.
-- choices::text는 JSON 표기라 안쪽 큰따옴표가 \" 로 나온다 — 따옴표 검색("합격")이 걸리게 되돌린다.
alter table bank_questions add column if not exists search_text text
  generated always as (
    regexp_replace(
      stem || ' ' || replace(coalesce(choices::text, ''), '\"', '"'),
      '\[\[그림\]\]\S+?\.(png|jpe?g|gif|webp)(#[0-9]+x[0-9]+)?',
      '',
      'g'
    )
  ) stored;

-- ilike '%키워드%'용 trigram 인덱스 (stem용 20260820010000과 같은 이유)
create extension if not exists pg_trgm;
create index if not exists bank_questions_search_trgm
  on bank_questions using gin (search_text gin_trgm_ops);

-- 확인
select count(*) filter (where search_text like '%[[그림]]%') as token_left,
       count(*) filter (where search_text ilike '%VLOOKUP%') as vlookup
from bank_questions;
