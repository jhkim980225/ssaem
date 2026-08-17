-- 전자서명 기록. 평가 응시 등에서 "본인이 응시했다"는 확인을 남긴다.
--
-- 범용 설계(kind + ref_id): 지금은 평가(assessment)용이지만, 나중에 다른 곳에서도
-- 같은 테이블을 쓴다. ref_id는 대상 행의 id(평가 응시 = assessment_attempts.id).
-- 평가 테이블이 아직 없으므로 FK를 걸지 않는다 — A(평가 세트) 구현 시 kind별로 검증한다.
create table if not exists signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('assessment')),
  ref_id uuid,
  image text not null,               -- PNG dataURL (data:image/png;base64,...)
  signed_at timestamptz default now(),
  ip text,                           -- 보조 확인 지표 (서명 자체가 신원 증명은 아니므로)
  user_agent text
);
create index if not exists signatures_user_idx on signatures(user_id, signed_at desc);
create index if not exists signatures_ref_idx on signatures(kind, ref_id);

alter table signatures enable row level security;
-- 클라이언트 정책 없음 = service_role만. 접근 제어는 앱 코드(requireUser + 본인 필터).
drop policy if exists signatures_self on signatures;
