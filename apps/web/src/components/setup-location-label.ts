import { monsters, type BoardDefinition, type HexKey, type SetupState } from "@abominations/game-engine";

export function setupLairLabel(setup: SetupState, board: BoardDefinition | undefined, monsterId: string, key: string): string {
  const hex = board?.hexes[key as HexKey];
  if (hex?.label) return hex.label;
  const lairs = [...(setup.definition.lairsByMonster[monsterId] ?? [])].sort((a, b) => {
    const first = board?.hexes[a as HexKey], second = board?.hexes[b as HexKey];
    return (first?.audit?.row ?? first?.coord.r ?? 0) - (second?.audit?.row ?? second?.coord.r ?? 0) || (first?.coord.q ?? 0) - (second?.coord.q ?? 0);
  });
  const name = monsters.find((monster) => monster.id === monsterId)?.name ?? "Monster";
  return `${name} · ${["Northern", "Middle", "Southern"][lairs.indexOf(key)] ?? "Starting"} lair`;
}
