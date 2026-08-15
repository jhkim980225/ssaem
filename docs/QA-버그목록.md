# QA 버그 목록 (2026-08-14~15)

기능-명세.md 페이지 표 기준, 기능 하나씩 헤드리스 브라우저 실사용 검증.
발견 즉시 여기 기록 → 수정 → 재검증 → 커밋. 상태: 발견 / 수정중 / 수정완료(커밋) / 보류(사유).

> **2026-08-15 추가:** 다중 에이전트 코드 리뷰(6렌즈 + 적대적 검증) 결과를 아래
> "## 코드 리뷰 findings 트리아지"에 정리. 적대적 검증 통과 HIGH 2건 + 코드 직접
> 재검증한 백엔드 결함 7건 수정 완료, 나머지는 상태·사유 표기.

| # | 기능 | 심각도 | 증상 | 상태 |
|---|---|---|---|---|
| 1 | 전 페이지 | critical | package.json UTF-8 BOM으로 전 페이지 500 (v0.11.4 범프 때 PowerShell `Set-Content -Encoding utf8`이 BOM 삽입 — SiteFooter가 package.json import라 빌드 깨짐) | 수정완료 — BOM 제거, 커밋 예정 |
| 2 | /teacher 자료 기록 | low | document_events에 CP949 깨진 제목 2건 잔존 (7/20 테스트 잔재, 문서는 이미 삭제됨) | 처리완료 — 데이터 2건 삭제, 전 테이블 mojibake 스캔 0건 확인 |

## 검증 로그

| 기능 | 결과 |
|---|---|
| `/` 랜딩 | 통과 — 의도된 /login 리다이렉트 (랜딩 숨김 주석 확인) |
| `/login` 로그인·회원가입 | 통과 — 학생/강사 로그인, 틀린 비번 에러 표시, 가입 폼 렌더 |
| `/reset` | 통과 — 렌더·안내 문구 |
| `/ask` 질문·답변 | 통과 — 스트리밍 답변, 출처 5건, 평가("평가 감사해요"), 콘솔 에러 0 |
| `/my/history` | 통과 — 목록 9건·상세 펼침 |
| `/quiz` | 통과 — 채점·해설·보기 비활성화·다음 문제 |
| `/quiz/notes` | 통과 — 오답 표시(정답 파랑/내 답 빨강 스크린샷 확인), 다시 맞히면 자동 제외 |
| `/bank` | 통과 — 필터 트리, 이론 채점, 실무 정답 보기+자가채점 |
| `/bank/notes` | 통과 — 틀림 처리 문항 노출 |
| `/teacher` | 통과 — 프로필·초대링크·강좌·자료 43건, 자가 테스트 채팅, 무료 플랜 한도(10건) 초과 등록 차단 확인 |
| `/teacher/insights` | 통과 — 14일 추이·평가 집계·자료 공백(유사도 0.45 미만·근거 없음) |
| `/teacher/history` | 통과 — 깨진 제목 0건(정리 효과 화면 확인), 미해결 큐 필터 |
| `/teacher/students` | 통과 — 학생 2명 리포트·최근 질문·비밀번호 초기화 버튼 |
| `/admin` | 통과 — 원장 로그인(페이지 내 폼), 기간별 통계·일별 그래프·강사 숨기기↔공개 토글 왕복·초대 링크 |
| 정적 (`/install` `/legal/*` `/pricing` `/a/default`) | 통과 — 전부 렌더, `/a/default`는 `/ask?academy=default`로 진입 |
| 모바일 (375px) | 통과 — `/ask` `/bank` 가로 오버플로 없음 |
| e2e 재실행 | 94 통과 · 실패 0 |

## 총평

기능 9개 그룹 전부 통과. 코드 버그는 #1(BOM) 1건 — QA 시작 직후 발견·수정. #2는 데이터 잔재 정리.
콘솔 에러 0 (한도 초과 403·틀린 비번 400은 의도된 응답).

---

## 코드 리뷰 findings 트리아지 (2026-08-15)

다중 에이전트(6렌즈: 권한·ask파이프라인·퀴즈/은행·강사/원장·클라이언트·설정) 코드 리뷰 38건.
적대적 검증까지 끝난 것은 HIGH 2건(세션 한도로 나머지 검증 미완). 각 건을 **코드를 직접 읽어
재검증**해 진짜만 수정하고, 오탐·의도·잠재는 사유를 남긴다.

### 수정 완료 (v0.11.7~0.11.8)

| 심각도 | 위치 | 결함 | 수정 |
|---|---|---|---|
| high | `api/ask/route.ts` | 크로스학원 자료 유출 — teacherId만 알면 남 학원 강사 비공개 자료가 답변·X-Sources로 노출 | `sameAcademy()` 게이트 추가(404). tenant-check 회귀 케이스 2건 |
| high | `lib/retrieve.ts` | 임베딩 API 429 등 throw를 안 잡아 `/api/ask` 전체 500 | `embed().catch(()=>null)`→lexical 폴백, retrieve DB에러도 빈 근거 강등, teacherId uuid 검증 |
| high | `lib/documents.ts` saveDocument | 임베딩/청크 실패 시 청크 0개 유령 문서가 남아 한도 소모 | 실패 시 문서 행 롤백(try/catch delete) |
| high | `lib/documents.ts` updateDocument | 청크 먼저 삭제 후 재임베딩 실패 시 문서가 검색에서 소멸 | 재임베딩을 먼저 → 성공 후 update+삭제+삽입 |
| high | `api/bank/route.ts` | `limit(400)` 무순서 — 400 초과 과목(644~719)은 고정 일부만 출제, mode=wrong 오답 누락 | 후보 id 전체 페이지네이션 수집→셔플→본문 조회. mode=wrong도 오답 전체 교집합 |
| medium | `api/quiz/route.ts`·`bank/shared.ts`·`bank/attempt` GET | 오답노트 '마지막 시도'가 ascending+limit이라 시도 캡 초과 시 오래된 기록 기준 | descending+문항별 첫 등장(=최신) 채택 |
| medium | `lib/plan.ts` | 무료 일일 한도 '오늘'이 서버(UTC) 자정 → KST 09:00 리셋 | KST 자정 기준 `kstDayStartIso()` (askLimitError·usageFor) |
| medium | `quiz/page.tsx` submit | 채점 fetch 네트워크 throw 시 busy 영구 true → 퀴즈 잠김 | try/catch/finally로 busy 해제 |
| medium | `login/page.tsx` submit | 로그인/가입 fetch throw 시 '처리 중…' 영구 잠김 | 전체 body try/catch/finally 래핑 (v0.11.9) |
| medium | `teacher/page.tsx` makeQuiz | 문제 생성 fetch throw 시 quizBusy 잔존 → 그 자료 '문제 만들기' 버튼 영구 비활성 | try/catch/finally로 quizBusy 해제 (v0.11.9) |
| medium | `schema.sql` match_chunks | 마이그레이션(20260810)의 `d.kind<>'style'` 필터 드리프트 — 재실행 시 회귀 | schema.sql에 필터 추가 정렬 |
| low | `api/bank/route.ts` isTheory | GET/POST 판별 불일치(answer_idx) — choices만 있고 정답없는 문항이면 채점 400 막힘(현재 0건) | GET도 answer_idx까지 확인해 POST와 정렬(방어) |

### 보류 / 후속 (사유)

| 심각도 | 위치 | 내용 | 사유·계획 |
|---|---|---|---|
| medium | `api/admin`·`api/insights` `.limit(20000)` | PostgREST 1000행 캡에 걸려 큰 학원 통계 조용히 잘림 | 실제로 1000 캡 확인됨. 현재 데이터(81건) 미도달. 페이지네이션 리팩터 후속 |
| medium | `schema.sql` citations cascade | 자료 수정 시 과거 답변 message_citations가 cascade 삭제 → 인사이트 '자료 공백' 왜곡 | 설계상 트레이드오프(재청킹 시 chunk 교체). 인용 스냅샷 비정규화는 별도 설계 필요 |
| medium | `api/upload` MAX_CONTENT | PDF 추출 텍스트가 20만자 상한 우회 | 업로드 라우트에 상한 재적용 후속(회귀 위험 낮음, 다음 패스) |
| medium | client 토큰갱신 리로드 (`quiz`·`teacher`·`ask` preselect) | 세션 객체 갱신이 진행 중 화면 리셋/전환 | `session` 대신 `user.id`/토큰 ref로 의존성 축소하는 클라이언트 패스 후속 (ref 리팩터라 회귀 위험 — 별도 검증 패스) |
| medium | 기타 client busy (`uploadPdf`·`addDoc` 등) | fetch throw 시 상태 메시지 잔존(하드락 아님) | makeQuiz·login과 동형. 다음 클라이언트 패스에서 일괄 |
| medium | `lib/anthropic.ts` Gemini SSE | 스트림 내 error 이벤트 무시 → 실패가 '빈 정상 응답'으로 | 폴백 체인 에러 표면화 후속 |
| low | 다수 | TOCTOU 한도 경합, lite 폴백 model 컬럼 기록, ChatPanel 언마운트 abort, bank 필터 stale 배지, import valid() 등 | 영향 낮음·비경합 환경. 카탈로그만, 우선순위 낮음 |

> 미검증(세션 한도) findings 원본: 워크플로 journal `wf_d96660d1-ffe`. 위 표는 코드 직접 재검증 기준.
