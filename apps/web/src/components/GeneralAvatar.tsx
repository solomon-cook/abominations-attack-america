import type { CSSProperties } from "react";

const palettes = [
  { coat: "#426253", hat: "#34483f", trim: "#d8ad57", skin: "#d8a47d", hair: "#44342d" },
  { coat: "#536b7d", hat: "#354b5b", trim: "#d6b45f", skin: "#e6b990", hair: "#6b4937" },
  { coat: "#815448", hat: "#633f37", trim: "#e0bb68", skin: "#bd805f", hair: "#342b2a" },
  { coat: "#656347", hat: "#484b36", trim: "#deb960", skin: "#e0b48c", hair: "#75604a" },
  { coat: "#604d70", hat: "#443650", trim: "#edc76a", skin: "#d99a75", hair: "#382a35" },
  { coat: "#7a633d", hat: "#54442d", trim: "#e2bd68", skin: "#f0c6a0", hair: "#9a7655" },
];

function stableIndex(name: string) {
  let hash = 2166136261;
  for (const character of name.toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % palettes.length;
}

export function GeneralAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const palette = palettes[stableIndex(name)];
  const style = { "--avatar-coat": palette.coat, "--avatar-hat": palette.hat, "--avatar-trim": palette.trim, "--avatar-skin": palette.skin, "--avatar-hair": palette.hair, width: size, height: size } as CSSProperties;
  return <span className="general-avatar" style={style} role="img" aria-label={`${name}'s general portrait`}>
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="#211914" />
      <path d="M7 62c2-13 11-20 25-20s23 7 25 20" fill="var(--avatar-coat)" />
      <path d="m22 45 10 9 10-9-5-6H27z" fill="var(--avatar-skin)" />
      <path d="M18 29c0-14 6-21 14-21s14 7 14 21v8c-2 10-9 14-14 14s-12-4-14-14z" fill="var(--avatar-skin)" />
      <path d="M18 29c-2-13 4-22 14-22s16 8 14 22l-5-6-8-1-10 3z" fill="var(--avatar-hair)" />
      <path d="M12 22c1-11 8-17 20-17s19 6 20 17H12z" fill="var(--avatar-hat)" stroke="var(--avatar-trim)" strokeWidth="2" />
      <path d="M17 21h30" stroke="var(--avatar-trim)" strokeWidth="4" />
      <circle cx="32" cy="14" r="3" fill="var(--avatar-trim)" />
      <path d="M24 32h4m8 0h4" stroke="#32251f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M27 42q5 4 10 0" fill="none" stroke="#684335" strokeWidth="2" strokeLinecap="round" />
      <path d="M25 38q7-3 14 0l-3 4q-4-2-8 0z" fill="var(--avatar-hair)" />
      <path d="m20 54 5 3 2-5m17 2-5 3-2-5" fill="var(--avatar-trim)" />
      <path d="m32 48 2 3-2 3-2-3z" fill="#f3d27b" />
    </svg>
  </span>;
}
