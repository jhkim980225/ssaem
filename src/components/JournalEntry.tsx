// 실무분개 정답 렌더. 날짜는 제 줄로, "(차)…(대)…" 는 세로 구분선 2단으로.
// 소스 acct_quiz QuestionCard의 JournalText 로직을 acct_rag 토큰(--line, --sub)으로 재작성.
export default function JournalEntry({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 text-[14px] leading-relaxed">
      {text.split("\n").map((raw, i) => {
        let line = raw.trim();
        if (!line) return null;
        // 날짜(YYYY.M.D.) 를 별도 줄로 분리
        const dm = line.match(/^(\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\.?)\s*(.*)$/);
        const date = dm?.[1];
        if (dm) line = dm[2];
        const di = line.indexOf("(대)");
        const twoCol = line.includes("(차)") && di > 0;
        return (
          <div key={i}>
            {date && (
              <div className="mb-0.5 text-[12px] font-semibold text-sub">{date}</div>
            )}
            {twoCol ? (
              <div className="grid grid-cols-2">
                <div className="whitespace-pre-wrap break-words pr-3">{line.slice(0, di).trim()}</div>
                {/* --line은 blue-weak 배경 위에서 대비가 0이라 안 보인다 → 중간톤으로 */}
                <div
                  className="whitespace-pre-wrap break-words pl-3"
                  style={{ borderLeft: "1.5px solid color-mix(in srgb, var(--sub) 45%, transparent)" }}
                >
                  {line.slice(di).trim()}
                </div>
              </div>
            ) : (
              line && <div className="whitespace-pre-wrap break-words">{line}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
