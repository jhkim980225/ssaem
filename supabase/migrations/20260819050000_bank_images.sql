-- 문제 그림 자료 (증빙 캡처 등) URL 목록. 규칙: docs/문제은행-적재-규칙.md
alter table bank_questions add column if not exists images jsonb;
