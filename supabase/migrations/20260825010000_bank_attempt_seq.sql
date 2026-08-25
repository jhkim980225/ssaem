-- 시험 기록 상세의 문항 순서.
-- 한 회차의 시도는 한 번의 INSERT로 들어가 created_at이 전부 동률이라, 정렬 기준이 없어
-- 상세 화면의 문항 순서가 출제 순서와 무관하게 뒤섞였다. 순번을 직접 저장한다.
alter table bank_attempts
  add column if not exists seq int;

-- 옛 기록은 순번이 없다(null) — 조회 시 nulls last로 뒤에 붙인다.
