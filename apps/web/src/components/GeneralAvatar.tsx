const portraits = ["general-01", "general-02", "general-03", "general-04", "general-05", "general-06"] as const;

function stableIndex(name: string) {
  let hash = 2166136261;
  for (const character of name.toLowerCase()) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % portraits.length;
}

export function GeneralAvatar({ name, size = 48 }: { name: string; size?: number }) {
  const portrait = portraits[stableIndex(name)];
  return <span className="general-avatar" style={{ width: size, height: size }} role="img" aria-label={`${name}'s general portrait`}>
    <img src={`/assets/military/generals/${portrait}.webp`} alt="" />
  </span>;
}
