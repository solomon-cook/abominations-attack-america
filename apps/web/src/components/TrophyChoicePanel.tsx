import type { GameState } from "@abominations/game-engine";
import { MilitaryReference } from "./SheetReference";

type Props = {
  game: GameState;
  canAct: boolean;
  onChoose: (unitId: string) => void;
};

/** Publicly show the pending branch record, but expose trophy buttons only to its decision owner. */
export function TrophyChoicePanel({ game, canAct, onChoose }: Props) {
  const decision = game.pendingDecision;
  if (decision?.type !== "trophy-choice") return null;

  const availableReserveIds = canAct
    ? decision.unitIds.filter((id) => game.units.some((unit) => unit.id === id && unit.location === "record-tile"))
    : [];

  return <MilitaryReference
    sheet={decision.branch}
    game={{ ...game, currentPlayer: decision.playerIndex }}
    trophyUnitIds={availableReserveIds}
    onTrophy={canAct ? onChoose : undefined}
  />;
}
