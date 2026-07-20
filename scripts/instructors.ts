// 강사 10명 픽스처. 과목별 자료 + 검증용 질문.
// 컴퓨터학원 기준 자격증 과목들.

export type Material = { kind: "problem" | "style"; content: string };
export type Instructor = {
  id: string;
  name: string;
  subject: string;
  materials: Material[];
  // 검증: 이 질문 → expectIncludes 키워드가 든 청크가 top-1로 뽑혀야 함
  tests: { q: string; expectIncludes: string }[];
};

export const INSTRUCTORS: Instructor[] = [
  {
    id: "t01",
    name: "김대차",
    subject: "전산회계 2급",
    materials: [
      { kind: "problem", content: "거래의 8요소: 차변은 자산의 증가, 부채의 감소, 자본의 감소, 비용의 발생. 대변은 자산의 감소, 부채의 증가, 자본의 증가, 수익의 발생. 분개의 기본이므로 반드시 암기한다." },
      { kind: "problem", content: "시산표는 총계정원장 기록이 정확한지 검증한다. 차변 합계와 대변 합계가 일치해야 한다. 단, 분개 누락은 시산표로 발견할 수 없다." },
    ],
    tests: [
      { q: "차변에는 뭘 기입해요?", expectIncludes: "거래의 8요소" },
      { q: "시산표로 못 잡는 오류가 있나요?", expectIncludes: "시산표" },
    ],
  },
  {
    id: "t02",
    name: "이엑셀",
    subject: "컴퓨터활용능력 1급",
    materials: [
      { kind: "problem", content: "VLOOKUP은 세로로 값을 찾는다. =VLOOKUP(찾을값, 범위, 열번호, FALSE). 네번째 인자 FALSE는 정확히 일치, TRUE는 근사값이다. 실무에선 거의 FALSE를 쓴다." },
      { kind: "problem", content: "피벗테이블은 대량 데이터를 요약한다. 행, 열, 값 영역에 필드를 끌어 넣어 집계한다. 값 필드 설정에서 합계, 평균, 개수로 바꿀 수 있다." },
    ],
    tests: [
      { q: "브이룩업 네번째 인자 뭐예요?", expectIncludes: "VLOOKUP" },
      { q: "피벗으로 데이터 요약하려면?", expectIncludes: "피벗테이블" },
    ],
  },
  {
    id: "t03",
    name: "박정보",
    subject: "정보처리기사",
    materials: [
      { kind: "problem", content: "정규화는 데이터 중복을 줄인다. 1NF는 원자값, 2NF는 부분함수종속 제거, 3NF는 이행함수종속 제거, BCNF는 결정자가 후보키가 아닌 종속 제거다." },
      { kind: "problem", content: "블랙박스 테스트는 내부 구조를 모르고 입출력으로 검증한다. 동치분할, 경계값분석이 대표 기법이다. 화이트박스는 내부 로직 기반으로 커버리지를 본다." },
    ],
    tests: [
      { q: "3정규형이 뭐죠?", expectIncludes: "정규화" },
      { q: "경계값분석은 어떤 테스트?", expectIncludes: "블랙박스" },
    ],
  },
  {
    id: "t04",
    name: "최한글",
    subject: "워드프로세서",
    materials: [
      { kind: "problem", content: "머리말과 꼬리말은 모든 페이지 위아래에 반복 표시된다. 쪽 번호는 꼬리말에 자주 넣는다. 짝수/홀수 페이지를 다르게 설정할 수도 있다." },
      { kind: "problem", content: "글맵시는 글자를 그림처럼 꾸미는 기능이다. 제목 디자인에 쓴다. 반면 문단 첫 글자 장식은 첫 글자를 크게 만드는 기능으로 서로 다르다." },
    ],
    tests: [
      { q: "쪽번호 어디에 넣어요?", expectIncludes: "머리말과 꼬리말" },
      { q: "글맵시가 뭐예요?", expectIncludes: "글맵시" },
    ],
  },
  {
    id: "t05",
    name: "정파이",
    subject: "파이썬 코딩",
    materials: [
      { kind: "problem", content: "리스트 컴프리헨션: [x*2 for x in range(5)] 는 [0,2,4,6,8]. 조건은 뒤에 붙인다. [x for x in nums if x>0]. 가독성 좋고 for문보다 빠르다." },
      { kind: "problem", content: "딕셔너리는 key-value 쌍이다. d = {'a':1}. d.get('b', 0)은 없으면 기본값 0 반환. for k, v in d.items() 로 순회한다." },
    ],
    tests: [
      { q: "리스트 컴프리헨션 예시 줘", expectIncludes: "리스트 컴프리헨션" },
      { q: "딕셔너리 없는 키 접근하면?", expectIncludes: "딕셔너리" },
    ],
  },
  {
    id: "t06",
    name: "강디비",
    subject: "SQLD",
    materials: [
      { kind: "problem", content: "JOIN 종류: INNER는 양쪽 일치 행만. LEFT OUTER는 왼쪽 전부 + 오른쪽 일치. 일치 없으면 NULL. CROSS는 곱집합이다." },
      { kind: "problem", content: "GROUP BY는 그룹으로 집계한다. HAVING은 그룹 조건, WHERE는 행 조건이다. 집계함수 조건은 WHERE가 아니라 HAVING에 쓴다." },
    ],
    tests: [
      { q: "LEFT JOIN 결과 어떻게 나와요?", expectIncludes: "JOIN 종류" },
      { q: "집계 조건은 HAVING이에요 WHERE예요?", expectIncludes: "GROUP BY" },
    ],
  },
  {
    id: "t07",
    name: "문네트",
    subject: "네트워크관리사",
    materials: [
      { kind: "problem", content: "OSI 7계층: 물리-데이터링크-네트워크-전송-세션-표현-응용. 라우터는 3계층, 스위치는 2계층, 게이트웨이는 상위 계층에서 동작한다." },
      { kind: "problem", content: "서브넷 마스크 255.255.255.0 은 /24, 호스트 254개. TCP는 연결지향 신뢰성, UDP는 비연결 고속이다." },
    ],
    tests: [
      { q: "라우터는 몇 계층이에요?", expectIncludes: "OSI 7계층" },
      { q: "/24는 호스트 몇개?", expectIncludes: "서브넷 마스크" },
    ],
  },
  {
    id: "t08",
    name: "한포토",
    subject: "포토샵 그래픽",
    materials: [
      { kind: "problem", content: "레이어는 투명 필름을 겹치는 것과 같다. 위 레이어가 아래를 가린다. 레이어 마스크는 검은색으로 칠하면 숨기고 흰색으로 칠하면 드러낸다." },
      { kind: "problem", content: "클리핑 마스크는 아래 레이어 모양 안에만 위 레이어를 보이게 한다. 텍스트 안에 사진을 넣을 때 쓴다." },
    ],
    tests: [
      { q: "레이어 마스크에서 검은색 칠하면?", expectIncludes: "레이어는 투명 필름" },
      { q: "글자 안에 사진 넣으려면?", expectIncludes: "클리핑 마스크" },
    ],
  },
  {
    id: "t09",
    name: "서리눅",
    subject: "리눅스마스터",
    materials: [
      { kind: "problem", content: "권한: chmod 755 file 은 소유자 rwx, 그룹/기타 r-x. chmod 644는 소유자 rw-, 나머지 r--. 숫자는 r=4 w=2 x=1의 합이다." },
      { kind: "problem", content: "프로세스: ps aux 로 목록 확인, kill -9 PID 로 강제 종료, top 으로 실시간 자원 사용을 본다. grep과 파이프로 필터링한다." },
    ],
    tests: [
      { q: "chmod 755가 무슨 권한?", expectIncludes: "chmod 755" },
      { q: "프로세스 강제 종료 명령어?", expectIncludes: "ps aux" },
    ],
  },
  {
    id: "t10",
    name: "오시큐",
    subject: "정보보안기사",
    materials: [
      { kind: "problem", content: "대칭키는 암호화/복호화 같은 키(AES), 빠르지만 키 분배가 문제. 비대칭키는 공개키/개인키 쌍(RSA)으로 키 분배를 해결하나 느리다." },
      { kind: "problem", content: "SQL 인젝션은 입력값에 악성 쿼리를 삽입하는 공격이다. 대응은 프리페어드 스테이트먼트와 입력값 검증이다. XSS는 스크립트 삽입 공격이다." },
    ],
    tests: [
      { q: "AES랑 RSA 차이가 뭐죠?", expectIncludes: "대칭키" },
      { q: "SQL 인젝션 어떻게 막아요?", expectIncludes: "SQL 인젝션" },
    ],
  },
];
