# API 토큰 발급 가이드 (GPT · Claude)

이 서비스는 학생 질문에 답할 때 **AI 모델**을 부른다. 모델을 부르려면 각 회사에서 발급한
**토큰(=API 키)** 이 있어야 한다. 이 문서는 토큰을 어디서, 어떻게 받고, 어디에 넣는지를
설명한다. 개발 지식이 없어도 따라 할 수 있게 순서대로 적었다.

> **먼저 알아둘 것 — 토큰 vs 오어스(OAuth)**
> - 이 서버가 모델을 부르는 방식은 **API 키(비밀 토큰) 하나를 서버에 저장**해 두고 쓰는 방식이다.
>   서버가 회사(OpenAI·Anthropic)에 "이 키를 가진 사람입니다" 하고 요청을 보낸다.
> - "오어스(OAuth)"는 **사용자가 자기 계정으로 로그인해 권한을 위임**하는 방식이다(구글 로그인처럼).
>   챗봇 서버가 뒤에서 대신 부르는 지금 구조에는 API 키가 표준이고, 발급·관리가 더 단순하다.
> - 그래서 이 가이드는 **API 키 발급**을 중심으로 안내한다. 키 = 토큰이라고 보면 된다.
>   (오어스가 실제로 필요한 경우는 맨 아래 "부록"에 정리했다.)

⚠️ **키는 비밀번호다.** 카카오톡·메일·깃허브 등에 절대 그대로 올리지 말 것. 노출되면 즉시
콘솔에서 폐기(Revoke)하고 새로 발급한다. 요금이 실제 과금되므로 **사용 한도(Usage limit)** 를
꼭 걸어 둘 것.

---

## 1. Claude (Anthropic) 키 발급

Claude는 이 서비스의 **기본 답변 모델**이다.

1. https://console.anthropic.com 접속 → 회사(또는 개인) 계정으로 가입/로그인
2. 결제 등록: 왼쪽 메뉴 **Billing → Plans & Billing** 에서 카드 등록하고 크레딧 충전
   (선불 크레딧 방식. 처음엔 소액 $5~$20 정도로 시작해도 충분하다)
3. 한도 설정: **Billing → Usage limits** 에서 월 상한(예: $50)을 걸어 과금 폭주 방지
4. 키 발급: **API keys → Create Key**
   - 이름은 알아보기 쉽게 (예: `ssaem-prod`)
   - 만들면 `sk-ant-...` 로 시작하는 문자열이 **한 번만** 보인다 → 복사해서 안전한 곳에 보관
5. 이 값을 서버 환경변수 `ANTHROPIC_API_KEY` 에 넣는다 (아래 4번 참고)

| 항목 | 값 |
|---|---|
| 발급처 | https://console.anthropic.com → API keys |
| 키 형태 | `sk-ant-...` |
| 환경변수 이름 | `ANTHROPIC_API_KEY` |
| 모델 변경(선택) | `ANTHROPIC_MODEL` (기본 `claude-sonnet-4-6`) |

---

## 2. GPT (OpenAI) 키 발급

이 서비스에서 OpenAI 키는 **자료 검색용 임베딩**(문서를 숫자 벡터로 바꿔 관련 자료를 찾는 기능)에
쓸 수 있다. 답변 생성을 GPT로 바꾸고 싶을 때도 이 키가 기준이 된다.

1. https://platform.openai.com 접속 → 계정으로 가입/로그인
2. 결제 등록: **Settings → Billing** 에서 카드 등록 + 크레딧 충전
3. 한도 설정: **Settings → Limits** 에서 월 사용 한도(Usage limit) 설정
4. 키 발급: **API keys → Create new secret key**
   - Project를 하나 만들어(예: `ssaem`) 그 안에서 키를 발급하면 관리가 편하다
   - `sk-...` 로 시작하는 값이 **한 번만** 보인다 → 복사·보관
5. 이 값을 `OPENAI_API_KEY` 에 넣는다

| 항목 | 값 |
|---|---|
| 발급처 | https://platform.openai.com → API keys |
| 키 형태 | `sk-...` (프로젝트 키는 `sk-proj-...`) |
| 환경변수 이름 | `OPENAI_API_KEY` |
| 임베딩 모델(선택) | `EMBED_MODEL` (기본 `text-embedding-3-small`) |

---

## 3. (참고) Gemini 키 — 현재 무료 폴백

지금 서비스는 Claude/OpenAI 키가 없을 때 **Google Gemini 무료 티어**로 자동 폴백하도록 짜여 있다.
비용을 최소화하려면 Gemini 키만으로도 동작한다(품질·속도는 유료 모델보다 낮음).

1. https://aistudio.google.com/app/apikey → 구글 계정으로 **Get API key**
2. 발급된 값을 `GEMINI_API_KEY` 에 넣는다

| 환경변수 | 용도 |
|---|---|
| `GEMINI_API_KEY` | 답변 생성 폴백 + 임베딩 폴백 |

---

## 4. 발급한 키를 서버에 넣기

### 로컬 개발 (내 PC)

프로젝트 최상위에 `.env.local` 파일을 만들고 아래처럼 넣는다. (키는 예시)

```
# 필수 — Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...

# AI 모델 — 있는 것만 넣으면 우선순위대로 사용
ANTHROPIC_API_KEY=sk-ant-xxxx      # 답변 (1순위)
OPENAI_API_KEY=sk-proj-xxxx        # 임베딩 (1순위)
GEMINI_API_KEY=xxxx                # 둘 다 없을 때 무료 폴백
```

> `.env.local` 은 이미 `.gitignore` 에 있어 깃허브에 안 올라간다. 이 규칙을 절대 풀지 말 것.

### 배포 (Vercel)

Vercel 대시보드 → 프로젝트 → **Settings → Environment Variables** 에서 같은 이름·값으로 추가.
- 각 변수를 **Production / Preview / Development** 중 필요한 환경에 체크
- 저장 후 **재배포(Redeploy)** 해야 반영됨
- CLI로도 가능: `vercel env add ANTHROPIC_API_KEY`

---

## 5. 우선순위(폴백 체인) 정리

키를 여러 개 넣으면 아래 순서로 자동 선택된다. 하나도 없으면 답변 생성은 생략하고
검색 결과 미리보기만 반환한다(비용 0 체험 모드).

| 기능 | 1순위 | 2순위 | 없을 때 |
|---|---|---|---|
| 답변 생성 | `ANTHROPIC_API_KEY` (Claude) | `GEMINI_API_KEY` (Gemini) | 생성 생략, 검색 결과만 |
| 자료 검색(임베딩) | `OPENAI_API_KEY` | `GEMINI_API_KEY` | 키워드 검색으로 폴백 |

- Gemini 답변이 무료 일일 쿼터(429)에 걸리면 자동으로 더 가벼운 `flash-lite` 모델로 재시도한다.
- 임베딩 호출이 실패해도(쿼터 등) 질문이 끊기지 않고 키워드 검색으로 넘어간다. (v0.11.7 반영)

---

## 6. 발급 후 점검

키를 넣은 뒤 정상 동작을 확인하려면:

```bash
npx tsx scripts/verify-instructors.ts   # 검색·프롬프트 (외부 키 없어도 됨)
npm run dev                             # 띄우고 /ask 에서 실제 질문 던져보기
```

`/ask` 에서 질문했을 때 답변이 스트리밍으로 흐르고 아래 "출처"가 뜨면 정상이다.
답변 대신 경고 문구(`⚠️ AI 답변 생성 꺼짐`)가 나오면 답변 키가 안 잡힌 것 —
`ANTHROPIC_API_KEY` 또는 `GEMINI_API_KEY` 를 다시 확인한다.

---

## 부록 — 오어스(OAuth)가 실제로 필요한 경우

지금 구조(서버가 뒤에서 모델을 대신 호출)에는 API 키가 맞다. OAuth는 아래처럼
**최종 사용자 각자의 AI 계정으로 청구·권한을 위임**하고 싶을 때만 필요하다.

- 학원/사용자가 **자기 OpenAI·Anthropic 구독으로** 비용을 내게 하고 싶을 때
- 서드파티 앱으로서 "OpenAI로 로그인 / Anthropic으로 로그인" 버튼을 붙일 때

이 경우는 각 회사의 OAuth 앱 등록(client_id·client_secret 발급)과 콜백 URL 설정,
토큰 교환·갱신(refresh) 로직이 추가로 필요하다. 현재 서비스 요구사항에는 해당하지 않으므로,
그 방향으로 갈 때 별도로 설계한다. 필요해지면 이 문서에 흐름을 추가할 것.
