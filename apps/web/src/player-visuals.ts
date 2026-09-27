import type { Branch, GameState, MilitaryUnit } from "@abominations/game-engine";

export const BRANCH_MARK: Record<Branch, string> = {
  Army: "A",
  Navy: "N",
  "Air Force": "AF",
  Marines: "M",
};

const DEFAULT_BRANCHES: readonly Branch[] = ["Army", "Navy", "Air Force", "Marines"];

export function branchForPlayer(game: GameState, playerIndex: number): Branch {
  return game.setupAssignments?.[playerIndex]?.branch ?? DEFAULT_BRANCHES[playerIndex % DEFAULT_BRANCHES.length]!;
}

export type PlayerControlBadge = { id: "national-guard" | "mecha-monster" | "captain-colossal"; mark: "NG" | "MM" | "CC"; label: string };

export function playerControlBadges(game: GameState, playerIndex: number): PlayerControlBadge[] {
  const player = game.players[playerIndex];
  const cards = new Set([...(player?.researchCardIds ?? []), ...(player?.visibleResearchCardIds ?? [])]);
  const owned = (unitTypeId: string) => game.units.some((unit) => unit.ownerPlayer === playerIndex
    && unit.unitTypeId === unitTypeId
    && !game.removedUnitIds.includes(unit.id)
    && unit.location !== "permanently-removed"
    && (unit.health === undefined || unit.health > 0));

  return [
    ...(cards.has("Guard Commander") ? [{ id: "national-guard" as const, mark: "NG" as const, label: "National Guard command" }] : []),
    ...(owned("mecha-monster") ? [{ id: "mecha-monster" as const, mark: "MM" as const, label: "Mecha-Monster" }] : []),
    ...(owned("captain-colossal") ? [{ id: "captain-colossal" as const, mark: "CC" as const, label: "Captain Colossal" }] : []),
  ];
}

/** Public military units captured as trophies by this player's monster. */
export function trophyUnitsForPlayer(game: GameState, playerIndex: number): MilitaryUnit[] {
  const trophyUnitIds: string[] = [];
  let pendingTaker: number | undefined;

  for (const event of game.eventLog ?? []) {
    if (event.action === "trophy.choice-required") {
      pendingTaker = typeof event.detail.playerIndex === "number" ? event.detail.playerIndex : undefined;
      continue;
    }
    if (event.action !== "trophy.chosen") continue;

    const eventTaker = typeof event.detail.takerPlayerIndex === "number" ? event.detail.takerPlayerIndex : pendingTaker;
    if (eventTaker === playerIndex && typeof event.detail.unitId === "string") trophyUnitIds.push(event.detail.unitId);
    pendingTaker = undefined;
  }

  return trophyUnitIds.flatMap((id) => {
    const unit = game.units.find((candidate) => candidate.id === id);
    return unit ? [unit] : [];
  });
}
