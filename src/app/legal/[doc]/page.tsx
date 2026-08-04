import Link from "next/link";
import { notFound } from "next/navigation";

// 이용약관 / 개인정보처리방침. 계약 전 원장이 확인하는 문서.
// ponytail: 정적 텍스트 — 법률 검토 후 문구 교체 전제. CMS 불필요.
const DOCS = {
  terms: {
    title: "이용약관",
    updated: "2026-08-04",
    sections: [
      ["제1조 (목적)", "이 약관은 학원 AI 튜터(이하 \"서비스\")를 이용하는 학원·강사·학생과 운영자 사이의 권리와 의무를 정합니다."],
      ["제2조 (서비스 내용)", "서비스는 강사가 등록한 학습 자료를 근거로 학생의 질문에 답변을 생성합니다. 답변은 등록 자료를 바탕으로 하며, 학습 참고용입니다. 시험 결과나 자격 취득을 보장하지 않습니다."],
      ["제3조 (계정)", "학원 계정은 원장이 개설하고, 강사·학생은 초대 링크로 가입합니다. 계정 정보 관리 책임은 이용자에게 있으며, 도용이 의심되면 즉시 운영자에게 알려야 합니다."],
      ["제4조 (자료의 권리)", "강사가 등록한 자료의 저작권은 강사 또는 원 저작자에게 있습니다. 운영자는 답변 생성과 검색을 위해서만 자료를 처리하며, 다른 학원에 제공하지 않습니다. 타인의 저작물을 권한 없이 등록해 발생한 책임은 등록자에게 있습니다."],
      ["제5조 (금지 행위)", "자동화 도구로 대량 질문을 보내거나, 서비스를 역설계하거나, 타인의 계정으로 접근하는 행위를 금지합니다."],
      ["제6조 (요금과 해지)", "무료 플랜은 자료·질문 수 제한 안에서 이용할 수 있습니다. 유료 플랜은 월 단위로 청구하며, 해지 의사를 알린 다음 달부터 청구가 중단됩니다. 이미 결제된 기간의 이용은 유지됩니다."],
      ["제7조 (책임의 한계)", "운영자는 서비스 중단이나 답변 오류로 인한 간접 손해에 책임지지 않습니다. 다만 운영자의 고의·중과실로 인한 손해는 그러하지 않습니다."],
      ["제8조 (약관 변경)", "약관이 바뀌면 시행 7일 전에 서비스 안에 공지합니다. 변경에 동의하지 않으면 이용을 중단하고 해지할 수 있습니다."],
    ],
  },
  privacy: {
    title: "개인정보처리방침",
    updated: "2026-08-04",
    sections: [
      ["1. 수집하는 정보", "가입 시 이메일, 이름, 비밀번호(암호화 저장)를 받습니다. 서비스 이용 과정에서 질문·답변 내용, 답변 평가, 접속 IP가 저장됩니다."],
      ["2. 이용 목적", "계정 인증, 학원별 데이터 분리, 질문에 대한 답변 생성, 강사·원장용 학습 현황 통계, 오·남용 방지에 사용합니다."],
      ["3. 보관 기간", "계정이 유지되는 동안 보관하며, 탈퇴하거나 학원이 해지하면 30일 안에 파기합니다. 법령이 별도 보관을 요구하면 그 기간을 따릅니다."],
      ["4. 제3자 제공·처리 위탁", "개인정보를 판매하거나 광고 목적으로 제공하지 않습니다. 서비스 운영을 위해 다음에 처리를 위탁합니다 — 데이터 보관: Supabase, 호스팅: Vercel, 답변 생성: Anthropic 또는 Google(질문 내용과 관련 자료가 전달되며, 모델 학습에는 사용되지 않는 조건으로 이용)."],
      ["5. 미성년자", "만 14세 미만은 법정대리인의 동의를 받은 뒤 가입해야 합니다. 학원을 통해 가입하는 경우 학원이 보호자 동의를 확인할 책임이 있습니다."],
      ["6. 이용자의 권리", "본인 정보의 열람·정정·삭제, 처리 정지를 요청할 수 있습니다. 학원 소속 계정은 소속 학원 원장을 통해서도 요청할 수 있습니다."],
      ["7. 안전 조치", "비밀번호는 복호화 불가능한 형태로 저장하고, 전송 구간은 HTTPS로 암호화합니다. 학원 사이의 데이터는 서버에서 분리해 조회합니다."],
      ["8. 문의", "개인정보 관련 문의는 요금제 페이지의 도입 문의 폼으로 남겨 주세요."],
    ],
  },
} as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const d = DOCS[doc as keyof typeof DOCS];
  if (!d) notFound();

  return (
    <main className="flex-1 w-full max-w-2xl mx-auto px-5 py-12">
      <Link href="/" className="text-sub text-[13px]">
        ← 홈
      </Link>
      <h1 className="rise text-[26px] lg:text-[30px] font-extrabold mt-1">{d.title}</h1>
      <p className="rise d1 text-sub text-[13px] mt-1.5">시행일 {d.updated}</p>

      <div className="rise d2 mt-8 flex flex-col gap-6">
        {d.sections.map(([h, body]) => (
          <section key={h}>
            <h2 className="text-[15px] font-extrabold">{h}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed" style={{ color: "var(--sub-2)" }}>
              {body}
            </p>
          </section>
        ))}
      </div>

      <p className="mt-10 text-[12px] text-sub leading-relaxed">
        이 문서는 서비스 이해를 돕기 위한 것으로, 실제 계약 전 법률 검토를 거쳐 확정됩니다.
      </p>
    </main>
  );
}
