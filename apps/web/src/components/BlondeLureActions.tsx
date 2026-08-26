import type { GameCommand, GameState, HexKey } from "@abominations/game-engine";
import { boardForGame } from "../board-pin";

type Props = {
  game: GameState;
  canAct: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
  getLocationName: (key: HexKey) => string;
};

export function BlondeLureActions({ game, canAct, runCommand, getLocationName }: Props) {
  if (game.phase === "challenge" || game.phase === "game-over") return null;
  if (!game.players[game.currentPlayer]?.researchCardIds.includes("Blonde Lure")) return null;
  const board = boardForGame(game);
  if (!board) return null;
  const choices = game.monsters.flatMap((monster) => {
    if (typeof monster.location !== "string" || !/^-?\d+,-?\d+$/.test(monster.location)) return [];
    return board.edges
      .filter((edge) => edge.enabled && edge.from === monster.location)
      .map((edge) => ({ monster, destination: edge.to }));
  });
  if (choices.length === 0) return null;
  return (
    <div className="battle-choice research-global-choice" aria-label="Choose Blonde Lure target">
      <span>Blonde Lure: choose a monster and adjacent destination for its next Move, if able.</span>
      {choices.map(({ monster, destination }) => (
        <button
          key={`${monster.id}-${destination}`}
          disabled={!canAct}
          onClick={() => void runCommand({ type: "use-research", cardId: "Blonde Lure", targetMonsterId: monster.id, destination })}
        >
          Lure {monster.name} to {getLocationName(destination)}
        </button>
      ))}
    </div>
  );
}
