-- 개발자 역할 추가 — /dev 지표 대시보드 전용. 학원 데이터 권한은 앱 코드에서 dev 라우트만 허용.
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('teacher', 'student', 'admin', 'dev'));
