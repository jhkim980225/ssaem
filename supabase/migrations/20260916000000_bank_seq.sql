-- 회차 문항 번호(seq).
--
-- 회차 CBT는 "실제 시험처럼 원래 순서"로 내는데, 정렬 기준이 created_at뿐이었다.
-- 적재가 배치 upsert라 한 회차 15문항이 같은 시각이고(115개 회차 전부 동률),
-- 동률이면 Postgres가 돌려주는 순서는 보장되지 않아 1번에 세법 문제가 나오는 식으로 뒤섞였다.
--
-- 원본(세무사회 확정답안 PDF·기출 HWP)의 문항 번호를 그대로 넣는다. 이론만 번호가 있다(15문항).
-- 값이 없으면(구회차 일부·실무) NULL — API는 seq NULL을 뒤로 보내고 created_at으로 잇는다.
alter table bank_questions add column if not exists seq int;

create index if not exists bank_questions_source_seq_idx on bank_questions (source, seq);
