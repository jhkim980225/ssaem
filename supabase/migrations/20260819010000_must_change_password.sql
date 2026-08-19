-- 최초 로그인 시 비밀번호 변경 강제 플래그.
--
-- 학생 가입을 간소화하려고 초기 비밀번호를 **휴대폰 뒷 4자리**로 자동 설정한다.
-- 4자리 숫자는 경우의 수가 1만이고 같은 반 친구가 아는 정보라, 그대로 두면
-- 남의 계정 로그인 → 대리 응시·점수 열람이 가능하다.
-- 그래서 첫 로그인에서 반드시 바꾸게 하고, 바꾸기 전에는 앱 기능을 막는다.
alter table profiles
  add column if not exists must_change_password boolean not null default false;
