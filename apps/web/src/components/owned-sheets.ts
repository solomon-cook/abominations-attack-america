import { canDeployNationalGuard, type GameState } from "@abominations/game-engine";

export function ownedMilitarySheets(game: GameState, playerIndex: number, branch: string): string[] {
  const research = game.players[playerIndex]?.researchCardIds ?? [];
  const units = game.units.filter((unit) => unit.ownerPlayer === playerIndex && !game.removedUnitIds.includes(unit.id) && unit.location !== "permanently-removed" && (unit.health === undefined || unit.health > 0));
  return [branch,
    ...(canDeployNationalGuard(game, playerIndex) ? ["National Guard"] : []),
    ...(research.includes("X-Fighters") && units.some((unit) => unit.unitTypeId === "x-fighter") ? ["X-Fighters"] : []),
    ...(units.some((unit) => unit.unitTypeId === "mecha-monster") ? ["Mecha-Monster"] : []),
    ...(units.some((unit) => unit.unitTypeId === "captain-colossal") ? ["Captain Colossal"] : []),
  ];
}
