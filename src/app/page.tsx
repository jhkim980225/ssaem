import Link from "next/link";
import { serviceClient } from "@/lib/supabase";

export const revalidate = 300; // 숫자 스트립 5분 캐시

// 실 DB 카운트 — 마케팅 문구 대신 실데이터로 신뢰 (콴다·MagicSchool 패턴). 실패 시 0 → 스트립 숨김.
async function getStats() {
  try {
    const db = serviceClient();
    const [t, d, a] = await Promise.all([
      db.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("is_public", true),
      db.from("documents").select("id", { count: "exact", head: true }),
      db.from("messages").select("id", { count: "exact", head: true }).eq("role", "assistant"),
    ]);
    return { teachers: t.count ?? 0, docs: d.count ?? 0, answers: a.count ?? 0 };
  } catch {
    return { teachers: 0, docs: 0, answers: 0 };
  }
}

export default async function Home() {
  const stats = await getStats();

  return (
    <main className="relative flex-1 overflow-hidden">
      {/* 은은한 블루 글로우 배경 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[520px] rounded-full opacity-50"
        style={{ background: "radial-gradient(closest-side, rgba(61,107,244,0.1), transparent)" }}
      />

      <div className="relative mx-auto w-full max-w-[1600px] px-5 lg:px-8 py-14 lg:py-24">
        {/* 히어로 — 좌 텍스트 / 우 채팅 미리보기. 넓은 화면에서도 텍스트 줄 길이는 제한 */}
        <div className="grid gap-12 lg:grid-cols-[minmax(0,620px)_minmax(0,460px)] lg:gap-16 items-center lg:justify-center xl:justify-between">
          <div className="text-center lg:text-left">
            <h1 className="rise text-[34px] lg:text-[52px] leading-[1.2] font-extrabold tracking-tight">
              마스터 전산회계 학원
            </h1>
            <p className="rise d2 mt-5 text-[15px] lg:text-[17px] text-sub leading-relaxed">
              강사가 문제와 풀이를 올리면, 학생은 그 자료를 근거로
              <br className="hidden lg:block" /> 답을 받아요. 반복 질문 응대는 AI에게 맡기세요.
            </p>

            <div className="rise d3 mt-9 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link href="/login?role=teacher" className="btn btn-primary px-7 py-4 text-[15px] text-center">
                강사로 시작하기
              </Link>
              <Link href="/login?role=student" className="btn btn-ghost px-7 py-4 text-[15px] text-center">
                학생으로 시작하기
              </Link>
            </div>

            {stats.answers > 0 && (
              <div className="rise d4 mt-10 flex gap-8 justify-center lg:justify-start">
                {(
                  [
                    ["활동 강사", stats.teachers],
                    ["등록 자료", stats.docs],
                    ["누적 답변", stats.answers],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="text-center lg:text-left">
                    <p className="text-[22px] lg:text-[26px] font-extrabold tabular-nums">{n.toLocaleString()}</p>
                    <p className="text-[12px] text-sub mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 정적 채팅 미리보기 — 제품을 말 대신 화면으로 (일러스트·이모지 없음) */}
          <div className="rise d3 card p-5 lg:p-6 flex flex-col gap-3" aria-hidden>
            <div className="flex items-center gap-2.5 pb-3 border-b border-line">
              <span className="avatar !w-9 !h-9 !text-[14px]">김</span>
              <div>
                <p className="text-[14px] font-bold leading-tight">김대차 선생님</p>
                <p className="text-[12px] text-sub leading-tight">전산회계 2급</p>
              </div>
            </div>
            <div className="self-end max-w-[85%] px-4 py-2.5 text-[14px] leading-relaxed bg-blue text-white rounded-[18px] rounded-br-[6px]">
              선급비용이랑 미지급비용 차이가 뭐예요?
            </div>
            <div className="self-start max-w-[92%] px-4 py-2.5 text-[14px] leading-relaxed rounded-[18px] rounded-bl-[6px] border border-line bg-[var(--fill-2)]">
              선급비용은 먼저 낸 돈 중 아직 비용이 아닌 것, 미지급비용은 비용은 발생했는데 아직 안 낸
              거예요. 선생님 자료 3장의 분개 예시로 설명할게요.
            </div>
            <p className="self-start text-[12px] text-sub pl-1">근거: 선생님 자료 2건 인용</p>
          </div>
        </div>

        {/* 특징 3가지 — 텍스트 카드 */}
        <div className="mt-20 lg:mt-28 grid sm:grid-cols-3 gap-4 lg:gap-5">
          {(
            [
              ["자료 등록", "문제·풀이·PDF를 올리면 AI가 답할 때 바로 찾아 써요. 스캔한 PDF도 알아서 읽어요."],
              ["근거 기반 답변", "인터넷이 아니라 우리 학원 자료에서만 답을 찾아요. 어느 자료를 근거로 했는지도 함께 보여줘요."],
              ["질문 인사이트", "학생들이 뭘 어려워하는지, 어떤 답변이 아쉬웠는지 강사와 원장이 바로 확인해요."],
            ] as const
          ).map(([t, s], i) => (
            <div key={t} className={`rise d${i + 4} card card-hover p-6 lg:p-7`}>
              <p className="w-8 h-1 rounded-full bg-blue mb-4" aria-hidden />
              <p className="text-[16px] font-extrabold">{t}</p>
              <p className="mt-2 text-[14px] text-sub leading-relaxed">{s}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
