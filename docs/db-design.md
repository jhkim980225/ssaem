# DB 설계 (v2)

학원 단위 멀티테넌트 + 강사별 RAG 튜터.
대상: Supabase (Postgres 15 + pgvector + Auth).

## 왜 v1을 갈아엎나

| v1 문제 | v2 해결 |
|---|---|
| `materials` 한 행 = 청크 1개. 원본 문서 소실 | `documents`(원본) / `chunks`(조각) 분리 |
| 청킹 파라미터 바꾸면 재업로드해야 함 | 원본 보존 → 재청킹만 돌리면 됨 |
| 삭제 UI에 청크가 낱개로 나열됨 | 문서 단위 관리, 청크는 cascade |
| 학원 개념 없음. 강사 전역 공개 | `academies` 테넌트 + RLS 격리 |
| 학생이 익명 문자열 | `profiles` 계정 + `enrollments` |
| `qa_logs` 플랫 → 이어지는 질문 불가 | `conversations` + `messages` |
| 답변 품질 측정 불가 | `message_feedback` |

## ERD

```
academies ──┬── profiles ──┬── teacher_profiles
            │              └── enrollments ──┐
            └── courses ────────────────────┘
                   │
                   └── documents ── chunks (vector)
                          
conversations ── messages ── message_citations ── chunks
                    └── message_feedback
```

## 테이블

### academies — 학원
테넌트 루트. 모든 데이터 격리 기준.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| name | text | 학원명 |
| slug | text UNIQUE | URL용 (`/a/hansol`) |
| created_at | timestamptz | |

### profiles — 사용자 (auth.users 1:1)
강사·학생·관리자 공통. `id`는 `auth.users.id`를 그대로 씀 → JOIN 없이 `auth.uid()`로 RLS 판정.

| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK → auth.users | |
| academy_id | uuid → academies | 소속 학원 |
| role | text | `teacher` \| `student` \| `admin` |
| name | text | 표시 이름 |
| created_at | timestamptz | |

**결정**: 강사/학생을 별도 테이블로 나누지 않고 `role`로 구분. 한 사람이 학원 옮기거나 역할 바뀔 때 행 이동이 없음. 강사 전용 필드만 `teacher_profiles`로 분리.

### teacher_profiles — 강사 확장 (profiles 1:1)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK → profiles | |
| subject | text | 과목 |
| tone_note | text | 말투/톤 지시문 |
| is_public | bool | 학원 내 학생에게 노출 여부 |

### courses — 강좌/반
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| academy_id | uuid → academies | |
| teacher_id | uuid → profiles | 담당 강사 |
| title | text | 예: 전산회계 2급 야간반 |
| created_at | timestamptz | |

### enrollments — 수강 (학생 ↔ 강좌)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| course_id | uuid → courses | |
| student_id | uuid → profiles | |
| created_at | timestamptz | |
| | UNIQUE(course_id, student_id) | 중복 수강 방지 |

**결정**: 학생은 수강한 강좌의 강사에게만 질문 가능. RLS로 강제.

### documents — 원본 자료
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| teacher_id | uuid → profiles | 소유 강사 |
| course_id | uuid → courses NULL | 강좌 한정 자료 (NULL = 강사 전체 공용) |
| kind | text | `problem` \| `style` |
| title | text | 파일명 또는 요약 |
| source | text | `text` \| `pdf` |
| raw_text | text | 추출 원문 (재청킹용) |
| created_at | timestamptz | |

**결정**: `raw_text` 보존이 핵심. 청킹 크기/overlap 튜닝할 때 재업로드 없이 `chunks`만 갈아끼움.

### chunks — 청크 + 임베딩
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| document_id | uuid → documents | cascade |
| teacher_id | uuid → profiles | **비정규화**: 검색 시 JOIN 회피 |
| ord | int | 문서 내 순서 |
| content | text | 청크 본문 |
| embedding | vector(1536) | NULL 허용 (임베딩 키 없을 때 lexical 폴백) |
| created_at | timestamptz | |

**결정**: `teacher_id`를 documents에서 복제. 벡터 검색은 강사 단위 필터가 항상 붙는데, JOIN 걸면 ANN 인덱스를 못 타서 느려짐. 쓰기 시점에만 채우므로 불일치 위험 낮음.

**인덱스**: `hnsw (embedding vector_cosine_ops)` — ivfflat보다 recall/속도 우수하고 사전 학습(lists 튜닝) 불필요.

### conversations — 대화 세션
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| teacher_id | uuid → profiles | 대상 강사 |
| student_id | uuid → profiles NULL | 비로그인 허용 시 NULL |
| course_id | uuid → courses NULL | |
| title | text | 첫 질문 요약 |
| created_at | timestamptz | |

### messages — 메시지
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid PK | |
| conversation_id | uuid → conversations | cascade |
| role | text | `user` \| `assistant` |
| content | text | |
| model | text | 답변 생성 모델 |
| latency_ms | int | |
| created_at | timestamptz | |

**결정**: v1 `qa_logs`(질문+답변 한 행)를 두 행으로 분리. 이어지는 질문에 이전 맥락을 넣으려면 role 기반 시퀀스가 필요.

### message_citations — 인용 청크
| 컬럼 | 타입 | 비고 |
|---|---|---|
| message_id | uuid → messages | |
| chunk_id | uuid → chunks | |
| similarity | float | |
| | PK(message_id, chunk_id) | |

**용도**: "이 답변이 어느 자료 근거인지" 추적. 강사가 오답 원인 자료를 찾아 고칠 수 있음.

### message_feedback — 답변 평가
| 컬럼 | 타입 | 비고 |
|---|---|---|
| message_id | uuid PK → messages | |
| rating | int | 1(👎) / 5(👍) |
| comment | text | |
| created_at | timestamptz | |

## RLS 전략

기본 원칙: **학원 경계를 넘는 읽기 금지**.

- `profiles`: 같은 학원 사용자만 조회. 본인 행만 수정.
- `teacher_profiles`: 같은 학원 + `is_public` 강사만 조회. 본인만 수정.
- `documents` / `chunks`: 소유 강사 본인만. 학생은 직접 접근 불가 — 검색은 서버(service_role)가 대행.
- `conversations` / `messages`: 본인(학생) 또는 대상 강사만.
- 서버 API 라우트는 `service_role`로 RLS 우회하되, 반드시 토큰 검증 후 `teacher_id`/`student_id`로 범위를 좁혀 질의.

**핵심**: 학생에게 `chunks` 직접 SELECT를 절대 열지 않음. 열면 시험 문제 전체를 덤프할 수 있음.

## 검색 RPC

```sql
match_chunks(p_teacher uuid, p_query vector, p_k int, p_course uuid default null)
```
- 강사 필터 + (선택) 강좌 필터
- `embedding is not null`만
- 코사인 거리 정렬

임베딩 키가 없으면 앱이 `lib/lexical.ts` 랭킹으로 폴백 (현행 유지).

## 트레이드오프 / 남긴 것

- **청크 dedup 안 함** — 같은 문서 재업로드 시 중복 청크 생김. 문서 단위 삭제 후 재등록이 정답. 해시 dedup은 실제로 문제 될 때 추가.
- **버전 관리 없음** — 자료 수정 = 삭제 후 재등록. 이력 필요해지면 `documents.version` 추가.
- **임베딩 차원 1536 고정** — 모델 바꾸면 컬럼 재생성 필요. 다중 모델 병행 계획 없어서 고정.
- **conversations 요약 없음** — 대화 길어지면 토큰 폭증. 실제로 길어질 때 요약 컬럼 추가.

## 코드 영향 (v1 → v2)

아래 파일이 v1 테이블명을 참조 중 → 마이그레이션 필요:

| 파일 | 변경 |
|---|---|
| `src/lib/retrieve.ts` | `match_materials` → `match_chunks`, `materials` → `chunks` |
| `src/app/api/materials/route.ts` | `documents` 생성 후 `chunks` 삽입 |
| `src/app/api/upload/route.ts` | 동일 + `raw_text` 저장 |
| `src/app/api/ask/route.ts` | `qa_logs` → `conversations`/`messages` |
| `src/app/api/teachers/route.ts` | `teachers` → `profiles` + `teacher_profiles`, 학원 필터 |
| `src/app/teacher/page.tsx` | 문서 단위 목록 |
| `scripts/seed.ts` | 학원 → 강사 → 문서 순 시드 |
