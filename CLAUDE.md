# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 프로젝트

학원 AI 튜터 (RAG). 강사가 문제/풀이 자료 등록 → 학생이 `/ask`에서 강사 선택 후 질문 → 그 강사 자료 근거로 스트리밍 답변. Next.js 16 App Router + Supabase(Auth/Postgres/pgvector) + Claude/Gemini.

## 커맨드

```bash
npm run dev        # http://localhost:3000
npm run build
npm run lint       # eslint

# 검증 스크립트 (외부 API 키 불필요)
npx tsx scripts/test-chunk.ts           # 문서 청킹 검증
npx tsx scripts/verify-instructors.ts   # 강사 10명 자료/검색/프롬프트 (20/20)

# 시드 (Supabase 셋업 후)
npx tsx scripts/seed.ts                 # 강사 10명 생성. 로그인 <id>@a.test / 123456
```

테스트 프레임워크 없음 — 위 tsx 스크립트가 assert 기반 셀프체크.

## 환경 변수 (.env.local)

- 필수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- LLM/임베딩 키는 우선순위 폴백 체인 (아래 참조). 키 전무해도 동작함(검색 결과만 반환).

## 아키텍처

### 프로바이더 폴백 체인 (핵심 패턴)

이 코드베이스는 API 키 유무에 따라 단계적으로 동작 수준을 낮춘다:

- **답변 생성** (`src/lib/anthropic.ts` `generateStream`): `ANTHROPIC_API_KEY` → `GEMINI_API_KEY`(OpenAI 호환 SSE, SDK 없이 fetch). Gemini 429(일일 쿼터)면 flash-lite 모델로 자동 재시도. 키 전무 시 `/api/ask`가 생성 생략, 검색 결과 미리보기만 반환.
- **임베딩** (`src/lib/embed.ts`): `OPENAI_API_KEY` → `GEMINI_API_KEY`(3072→1536 MRL 축소+정규화) → `null`. 차원은 `vector(1536)` 고정 — 바꾸면 스키마·기존 데이터 전부 재작업.
- **검색** (`src/lib/retrieve.ts`): 임베딩 가능하면 pgvector `match_chunks` RPC, `null`이면 lexical 랭킹(`src/lib/lexical.ts`) 폴백.

프로바이더 교체는 해당 lib 파일 하나만 수정하면 되도록 격리돼 있음. 이 격리를 유지할 것.

### /api/ask 플로우 (가장 복잡한 경로)

`src/app/api/ask/route.ts`: 강사 조회 + retrieve + 대화 이력을 `Promise.all` 병렬 → 시스템 프롬프트 빌드(`src/lib/prompt.ts`) → `ReadableStream` 스트리밍. 주의점:

- conversation은 스트리밍 시작 **전에** 생성해 `X-Conversation-Id` 헤더로 전달 (스트리밍 중엔 헤더 못 바꿈)
- 클라이언트가 중간에 끊어도 이력 저장이 죽지 않게 enqueue를 try/catch 가드
- 이력(messages, message_citations) 기록은 스트림 종료 후, 실패해도 답변엔 무영향

### 인증/DB 접근 패턴

- 인증 API는 `userFromRequest()`(src/lib/auth.ts)로 Bearer 토큰 검증 — role 검사 없음, 소유권은 쿼리 eq 필터로 강제. 세션 쿠키 아님 — 클라이언트가 Supabase access_token을 헤더로 보냄.
- 서버는 전부 `serviceClient()`(service role, RLS 우회) 사용. 학생 `/ask`는 익명 허용, 로그인 시 대화가 `student_id`에 연결.

### DB

- 스키마: `supabase/schema.sql` (v2), 설계 근거·ERD: `docs/db-design.md`
- 핵심: `documents`(원본 보존) / `chunks`(청크+embedding) 분리 — 재청킹 시 원본에서 다시 생성. `profiles`는 `auth.users` id 그대로 사용, role로 강사/학생 구분.
- 대화: `conversations` → `messages` → `message_citations`(근거 청크 추적)
- 스키마 변경은 Supabase SQL editor에서 수동 실행 (마이그레이션 도구 없음)

### 문서 등록 플로우

업로드(텍스트/텍스트 PDF via unpdf) → 청킹(`src/lib/chunk.ts`) → `embedMany` 배치 임베딩 → chunks 저장. 스캔 PDF는 LLM 비전 OCR 폴백(`src/lib/ocr.ts`, Gemini→Anthropic, 15MB 상한).
