// 이름 기반 결정적 이모지 아바타 (토스식 이모지 서클)
const EMOJI = ["📘", "📊", "💻", "📝", "🐍", "🗄️", "🌐", "🎨", "🐧", "🔐", "📐", "⚡"];

export function avatarEmoji(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) | 0;
  return EMOJI[Math.abs(h) % EMOJI.length];
}
