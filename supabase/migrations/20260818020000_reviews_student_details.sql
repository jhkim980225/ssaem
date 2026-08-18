-- 수강평(D) + 학생 상세정보(E).
--
-- 수강평: 학생이 강사를 평가한다. 별점 1~5 + 한 줄 코멘트.
--   강사 화면에는 **익명**으로, 원장 화면에는 **실명**으로 보인다 (표시 정책은 앱 코드가 강제).
--   학생당 강사당 1건 — 다시 쓰면 수정(upsert)된다.
--   ⚠️ message_feedback(AI 답변 1건 평가)과 다른 개념이다. 이건 강사에 대한 평가.
create table if not exists course_reviews (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (teacher_id, student_id)   -- 1인 1강사 1건 (수정은 upsert)
);
create index if not exists course_reviews_teacher_idx on course_reviews(teacher_id, created_at desc);
create index if not exists course_reviews_student_idx on course_reviews(student_id);

-- 학생 상세정보: 연락처 + 강사 메모.
--
-- profiles에 컬럼을 붙이지 않고 **별도 테이블로 뺀 이유**: profiles는 목록·조인 등
-- 여러 경로에서 select되므로, 개인정보를 같은 행에 두면 실수로 흘러나갈 여지가 크다.
-- 별도 테이블이면 의도적으로 join해야만 조회된다 (열람 경로가 코드에서 명시적으로 드러남).
create table if not exists student_details (
  student_id uuid primary key references profiles(id) on delete cascade,
  phone text,                        -- 학생 본인 연락처
  note text,                         -- 강사 메모(특이사항)
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz default now()
);

alter table course_reviews  enable row level security;
alter table student_details enable row level security;
-- 클라이언트 정책 없음 = service_role만. 접근 제어·익명 처리는 앱 코드 책임.
drop policy if exists course_reviews_read   on course_reviews;
drop policy if exists course_reviews_self   on course_reviews;
drop policy if exists student_details_read  on student_details;
drop policy if exists student_details_write on student_details;
