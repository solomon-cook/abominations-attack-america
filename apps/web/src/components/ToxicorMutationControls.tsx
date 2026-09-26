import type { GameCommand, GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  canAct: boolean;
  runCommand: (command: GameCommand) => Promise<void> | void;
};

export function ToxicorMutationControls({ game, canAct, runCommand }: Props) {
  const decision = game.pendingDecision;
  if (decision?.type !== "mutation-choice") return null;
  return <div className="battle-choice" aria-label="Choose Toxicor Mutation card">
    <p>Toxicor revealed two Mutation cards. Choose one to keep; the other returns to the deck.</p>
    {decision.cardIds.map((cardId) => <button key={cardId} disabled={!canAct} onClick={() => void runCommand({ type: "choose-mutation-card", cardId })}>Keep {cardId}</button>)}
  </div>;
}
