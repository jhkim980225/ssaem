# RAG 질의응답

## POST /api/ask — 전체 플로우 (src/app/api/ask/route.ts)

1. 강사 조회 + `retrieve()`(질문 임베딩 포함) + 대화 이력(최근 10개, `HISTORY_LIMIT`)을 `Promise.all` 병렬.
2. 시스템 프롬프트 조립(`src/lib/prompt.ts`) — 강사 이름·과목 + 검색 청크 근거 주입.
3. LLM 키 전무 시: 생성 생략, 검색 근거 미리보기 JSON 반환 (비용 0 체험 모드).
4. conversation 스트리밍 시작 **전에** 생성 → `X-Conversation-Id` 헤더로 전달 (스트리밍 중엔 헤더 변경 불가). Bearer 토큰 있으면(로그인 학생) `student_id` 연결 — 익명은 NULL.
5. `ReadableStream`으로 텍스트 델타 스트리밍. enqueue를 try/catch 가드 — 클라이언트가 탭 닫아도 이력 저장까지 진행.
6. 생성 에러 중 429/quota/rate는 한국어 안내로 치환, 그 외는 앞 120자만 노출.
7. 스트림 종료 후 이력 기록: `messages`(모델명·latency_ms) + `message_citations`(근거 청크·유사도). 실패해도 답변 무영향.

## 검색 — src/lib/retrieve.ts

- 임베딩 가능: pgvector `match_chunks` RPC (강사·강좌 필터 + 코사인 top-k, 기본 k=5).
- 임베딩 불가(`embed()` → null): 강사 청크 최대 500개 로드 후 렉시컬 랭킹 폴백 (강좌 필터 동일 적용).
- 강좌 필터는 공용 자료(`course_id` null)를 항상 포함. `/api/ask`의 `courseId`는 uuid 형식 검증 후 사용.

## 렉시컬 폴백 — src/lib/lexical.ts

- 한국어 char 2-gram 겹침 + 토큰 완전일치 가중 스코어링.
- 프로덕션 폴백과 오프라인 검증 하네스(scripts)가 같은 코드 공유.

## LLM 스트리밍 — src/lib/anthropic.ts

- `generateStream(system, messages, maxTokens=1200)` — 텍스트 델타 async generator.
- `ANTHROPIC_API_KEY` 있으면 Anthropic SDK 스트리밍 (`ANTHROPIC_MODEL`, 기본 claude-sonnet-4-6).
- 없으면 Gemini OpenAI 호환 SSE를 fetch로 직접 파싱 (SDK 미설치):
  - `reasoning_effort: "none"` — thinking 토큰이 max_tokens 잠식해 답변 잘리는 것 방지.
  - 429(무료 일일 쿼터, 모델별 별도 버킷) 시 `GEMINI_FALLBACK_MODEL`(flash-lite)로 1회 재시도.
  - SSE 파싱: 미완성 라인 버퍼 유지, keep-alive 무시.

## 대화 이력 조회 — GET /api/conversations (강사·학생 공용)

- 무인자: 내 대화 목록 (최근 50, 대화별 메시지 수). `profiles.role`로 분기 — 강사는 `teacher_id`, 학생은 `student_id` 필터. 학생 목록엔 강사 이름 포함. 응답에 `role` 동봉.
- `?id=<uuid>`: 해당 대화 메시지 전체 — 당사자(강사 또는 학생) 확인 후 반환, 아니면 404.
