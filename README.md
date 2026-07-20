# 학원 AI 튜터 (sstest)

선생님별 로그인 → 문제/풀이 등록 → 학생은 그 자료 근거로 답변 받는 RAG 서비스.

## 스택
- Next.js 16 (App Router, TS, Tailwind, 반응형)
- Supabase (Auth + Postgres + pgvector)
- Claude API (답변 생성)
- 임베딩: Gemini `gemini-embedding-001` 1536차원 (OPENAI_API_KEY 있으면 OpenAI 우선, 둘 다 없으면 키워드 폴백)

## 구조
```
src/app/            page(랜딩) / teacher(대시보드) / ask(학생)
src/app/api/        teachers · profile · documents · upload · ask
src/components/     ChatPanel (강사 자가테스트 + 학생 공용)
src/lib/            supabase · auth · embed · anthropic · retrieve · chunk · lexical · prompt · documents
supabase/schema.sql DB 스키마 v2 (설계: docs/db-design.md)
```

## 셋업
1. Supabase 프로젝트 생성 → SQL editor에서 `supabase/schema.sql` 실행
2. `.env.local` 채우기:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `GEMINI_API_KEY` — 답변 생성(무료)+임베딩. (선택) `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` 있으면 우선.
3. `npm run dev` → http://localhost:3000

## 흐름
- 선생님: `/teacher` 가입/로그인 → 프로필(이름·과목) 저장 → 문제/풀이 추가 (자동 임베딩)
- 학생: `/ask` 선생님 선택 → 질문 → 관련 자료 검색 후 근거 기반 답변

## 검증 (외부 API 불필요)
- `npx tsx scripts/test-chunk.ts` — 전산회계 2급 문서 청킹
- `npx tsx scripts/verify-instructors.ts` — 강사 10명 자료/검색/프롬프트 (20/20)

## 시드 (Supabase 준비 후)
- `npx tsx scripts/seed.ts` — 강사 10명 자동 생성. 로그인 `<id>@a.test / 123456`

## 구현됨
- 선생님 로그인·프로필·자료(텍스트/PDF) 등록·삭제
- 문서 청킹 → 청크별 임베딩 저장
- 학생 질문 → RAG 검색(임베딩/lexical 폴백) → 근거 기반 스트리밍 답변
- Q&A 이력 기록(qa_logs)

## 남은 것 (TODO)
- 스캔 PDF OCR (지금은 텍스트 PDF만)
- 자료 수정(현재 삭제 후 재등록)
- 선생님용 학생 질문 이력 조회 화면
- Supabase 이메일 인증 설정 (개발 중엔 confirm 끄면 편함)
