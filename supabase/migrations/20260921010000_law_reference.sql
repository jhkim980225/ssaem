-- 공용 참고자료(법령) — 강사 소유가 아닌 전역 자료.
-- Supabase SQL Editor에 통째로 붙여넣어 실행. 여러 번 실행해도 안전하다.
--
-- 왜: 세법은 매년 바뀌는데 기출 해설과 모델 지식은 출제 당시에 멈춰 있다. 현행 법령
-- 조문을 검색 근거로 깔아 두면 "지금 기준으로는 얼마인가"에 답할 수 있다.
--
-- 설계: 별도 테이블을 두지 않고 `teacher_id IS NULL`을 "공용"으로 쓴다.
--   - message_citations.chunk_id 가 chunks(id)를 참조한다 — 법령을 다른 테이블에 두면
--     근거(출처) 기록이 통째로 끊긴다.
--   - 강사 자료 조회는 전부 `eq(teacher_id, uid)`라 NULL 행이 섞여 들어가지 않는다.
--   - 학생에게 보이는 강사 목록(profiles)에 시스템 계정을 만들지 않아도 된다.

-- ─────────────────────────────────────────────
-- ① teacher_id 를 NULL 허용으로 (NULL = 공용 참고자료)
-- ─────────────────────────────────────────────
alter table documents alter column teacher_id drop not null;
alter table chunks    alter column teacher_id drop not null;

-- ─────────────────────────────────────────────
-- ② documents.kind 에 'law' 추가
-- ─────────────────────────────────────────────
-- 제약 이름이 환경마다 다를 수 있어 정의로 찾아 지운다(재실행 시 새 제약도 같은 조건에
-- 걸려 지워졌다가 다시 붙는다 — 멱등).
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'documents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%kind%'
      and pg_get_constraintdef(oid) like '%problem%'
  loop
    execute format('alter table documents drop constraint %I', c.conname);
  end loop;
end $$;

-- 'law_draft' = 적재 중인 법령. 검색에서 빠진다 (아래 match_reference_chunks 참고).
-- 법령 하나가 수백 청크라 임베딩 한도에 걸려 20분 넘게 걸린다 — 그동안 옛 자료를
-- 지워 두면 답변 근거가 통째로 비는 시간이 생긴다. 다 채운 뒤에 갈아끼운다.
alter table documents
  add constraint documents_kind_check check (kind in ('problem', 'style', 'law', 'law_draft'));

-- 공용 청크만 빠르게 훑는 부분 인덱스 (teacher_id 는 NULL 비중이 작다)
create index if not exists chunks_reference_idx on chunks (teacher_id) where teacher_id is null;

-- 같은 문서에 같은 ord 가 두 번 들어가지 못하게. 적재가 중간에 끊겨 이어서 넣을 때
-- 앞 프로세스가 아직 살아 있으면 같은 청크가 두 벌 들어간다 (실제로 38행 발생).
create unique index if not exists chunks_doc_ord_uniq on chunks (document_id, ord);

-- ─────────────────────────────────────────────
-- ③ 검색 RPC
-- ─────────────────────────────────────────────
-- 강사 자료 검색은 **원래대로 강사 것만** 본다. 한 쿼리에서 섞으면 소득세 질문 하나에
-- 법령 조문이 상위 k개를 다 차지해 정작 그 선생님 자료가 밀려난다.
-- 공용 참고자료는 아래 별도 함수로 뽑아 앱에서 정해진 몫만큼만 합친다.
create or replace function match_chunks(
  p_teacher uuid,
  p_query vector(1536),
  p_k int default 5,
  p_course uuid default null
) returns table (id uuid, document_id uuid, content text, kind text, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.content, d.kind,
         1 - (c.embedding <=> p_query) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where c.teacher_id = p_teacher
    and c.embedding is not null
    and d.kind <> 'style'   -- 말투 자료는 검색 근거에서 제외 (마이그레이션 20260810과 정렬)
    and (p_course is null or d.course_id is null or d.course_id = p_course)
  order by c.embedding <=> p_query
  limit p_k;
$$;

-- 공용 참고자료(법령) 검색 — 강사·강좌와 무관하다.
-- kind = 'law' 만 본다: 적재 중('law_draft')인 법령은 절반만 채워져 있어 근거로 쓰면
-- "그 조문은 없다"는 식의 틀린 답이 나간다.
create or replace function match_reference_chunks(
  p_query vector(1536),
  p_k int default 3
) returns table (id uuid, document_id uuid, content text, kind text, similarity float)
language sql stable as $$
  select c.id, c.document_id, c.content, d.kind,
         1 - (c.embedding <=> p_query) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where c.teacher_id is null
    and d.kind = 'law'
    and c.embedding is not null
  order by c.embedding <=> p_query
  limit p_k;
$$;

-- ─────────────────────────────────────────────
-- 확인
-- ─────────────────────────────────────────────
select kind, count(*) filter (where teacher_id is null) as 공용, count(*) as 전체
from documents group by kind order by kind;
