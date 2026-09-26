import type { GameCommand, GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canAct: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
  battleId?: string;
};

export function StabilizerRayControls({ game, canAct, runCommand, battleId }: Props) {
  if (game.pendingDecision?.type === "stabilizer-ray-choice" && game.pendingStabilizerRayChoice) {
    const monsterName = game.monsters.find((monster) => monster.id === game.pendingStabilizerRayChoice?.monsterId)?.name ?? "the monster";
    return <div className="battle-choice" aria-label="Choose Mutation for Stabilizer Ray">
      <p>Military damage landed. Choose one Mutation card to discard from {monsterName}.</p>
      {game.pendingStabilizerRayChoice.cardIds.map((mutationCardId) => <button key={mutationCardId} disabled={!canAct} onClick={() => void runCommand({ type: "choose-stabilizer-ray-mutation", cardId: mutationCardId })}>Discard {mutationCardId}</button>)}
    </div>;
  }
  if (battleId && game.pendingDecision?.type === "battle-resolution" && game.players[game.currentPlayer]?.researchCardIds.includes("Stabilizer Ray")) {
    return <button disabled={!canAct} onClick={() => void runCommand({ type: "use-research", cardId: "Stabilizer Ray", battleId })}>Play Stabilizer Ray · choose a Mutation if damage lands</button>;
  }
  return null;
}
