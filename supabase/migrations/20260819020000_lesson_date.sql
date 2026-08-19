-- 수업 날짜: 강좌 ROOM 달력에서 "그 날 수업 자료"를 묶는다. NULL = 날짜 미지정 일반 자료.
alter table documents add column if not exists lesson_date date;
