// 전자서명 검증. 캔버스에서 만든 PNG dataURL만 받는다.
//
// ⚠️ 이 서명은 공인인증서 같은 법적 전자서명이 아니다. "본인이 응시했다"는 확인과
// 심리적 억제, 그리고 사후 대조용 기록이다. 신원 증명은 로그인 계정이 담당한다.

/** dataURL 상한 (base64 팽창 포함). 손글씨 서명 PNG는 보통 10~50KB. */
export const MAX_SIGNATURE_BYTES = 300_000;

const PNG_DATAURL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

export type SignatureCheck = { ok: true } | { ok: false; error: string };

/** PNG dataURL 형식·크기 검증. 서버·클라이언트 공용. */
export function checkSignature(image: unknown): SignatureCheck {
  if (typeof image !== "string" || !image) return { ok: false, error: "서명이 없어요." };
  if (image.length > MAX_SIGNATURE_BYTES) return { ok: false, error: "서명 이미지가 너무 커요." };
  const m = PNG_DATAURL.exec(image);
  if (!m) return { ok: false, error: "서명 형식이 올바르지 않아요." };
  // base64 길이는 4의 배수 — 잘린 데이터 거르기
  if (m[1].length % 4 !== 0) return { ok: false, error: "서명 데이터가 손상됐어요." };
  return { ok: true };
}

/**
 * 빈 서명(그린 게 없음) 판정.
 * 캔버스를 그대로 내보내면 투명 PNG가 나오는데 형식은 멀쩡하므로 따로 걸러야 한다.
 * 클라이언트가 "획을 그었는지"를 아는 게 정확하므로 실제 판정은 컴포넌트가 하고,
 * 서버는 최소 바이트로 방어한다 (빈 PNG는 아주 작다).
 */
export const MIN_SIGNATURE_BYTES = 600;

export function looksBlank(image: string): boolean {
  return image.length < MIN_SIGNATURE_BYTES;
}
