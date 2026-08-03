// 이름 첫 글자 이니셜 아바타 (웹 스타일 — 이모지 제거)
export function avatarEmoji(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}
