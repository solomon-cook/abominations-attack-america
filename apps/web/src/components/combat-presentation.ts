import type { BattleAttack } from "@abominations/game-engine";

/** Older/reconnected event logs may not contain the optional combat snapshots. */
export function readBattleAttacks(value: unknown): BattleAttack[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is BattleAttack => Boolean(item && typeof item === "object"
    && typeof item.attackerId === "string" && typeof item.targetId === "string"
    && Number.isInteger(item.roll) && item.roll >= 1 && item.roll <= 6
    && typeof item.hit === "boolean" && typeof item.damage === "number"
    && typeof item.destroyed === "boolean"));
}

export function healthAtAttack(id: string, attacks: readonly BattleAttack[], index: number, fallback: number): number {
  // Use exact snapshots, including capped damage, rather than subtracting nominal damage.
  for (let i = Math.min(index, attacks.length - 1); i >= 0; i--) {
    if (attacks[i].targetId === id && attacks[i].targetHealthAfter !== undefined) return attacks[i].targetHealthAfter!;
  }
  for (let i = Math.max(0, index + 1); i < attacks.length; i++) {
    if (attacks[i].targetId === id && attacks[i].targetHealthBefore !== undefined) return attacks[i].targetHealthBefore!;
  }
  return fallback;
}

export function healthLost(attack: BattleAttack): number | undefined {
  return attack.targetHealthBefore !== undefined && attack.targetHealthAfter !== undefined
    ? Math.max(0, attack.targetHealthBefore - attack.targetHealthAfter)
    : undefined;
}

export function attackResultLabel(attack: BattleAttack): string {
  if (!attack.hit) return "Miss";
  if (attack.destroyed) return attack.targetHealthAfter !== undefined ? "Defeated" : "Destroyed";
  const lost = healthLost(attack);
  return lost !== undefined ? `−${lost} Health` : `${attack.damage} damage`;
}

export function militaryArt(unitTypeId?: string): string | undefined {
  if (!unitTypeId) return undefined;
  if (unitTypeId === "mecha-monster" || unitTypeId === "captain-colossal") return `/assets/military/portraits/${unitTypeId}.webp`;
  return `/assets/military/${unitTypeId === "navy-nuclear-submarine-missile" ? "navy-launched-cruise-missile" : unitTypeId}.webp`;
}
