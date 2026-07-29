# DB

스키마: `supabase/schema.sql` (v2). 설계 근거·전체 ERD: [../db-design.md](../db-design.md).
스키마 변경은 Supabase SQL editor에서 수동 실행 (마이그레이션 도구 없음).

## 구조 요약

```
academies ──┬── profiles ──┬── teacher_profiles (subject, is_public)
            │              └── enrollments
            └── courses ── documents ── chunks (vector 1536)

conversations ── messages ── message_citations ── chunks
                    └── message_feedback
document_events (감사 로그)
```

## 핵심 결정

- `profiles.id` = `auth.users.id` 그대로 사용 — JOIN 없이 `auth.uid()`로 RLS 판정.
- 강사/학생은 별도 테이블 아닌 `role` 컬럼 구분. 강사 전용 필드만 `teacher_profiles` 1:1 분리.
- `documents`(원본 보존) / `chunks`(조각) 분리 — 청킹 파라미터 변경 시 원본에서 재청킹만 하면 됨. 삭제는 문서 단위, 청크 cascade.
- `chunks.embedding`은 `vector(1536)` 고정 — 차원 변경은 스키마+기존 데이터 전체 재작업.
- `messages`에 모델명·latency_ms 저장, `message_citations`에 근거 청크·유사도 — 답변 품질 추적용.
- `document_events.action`은 created/deleted만 (check 제약) — 수정은 deleted+created 쌍으로 기록.

## match_chunks RPC

- 파라미터: 강사 id, 질문 벡터, k, (선택) course id.
- 강사·코스 필터 후 코사인 유사도 top-k 반환 (id, content, kind, similarity).
