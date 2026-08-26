import type { GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
};

const phases = ["move", "fight", "encounter", "deploy", "challenge"] as const;

export function TurnProgress({ game }: Props) {
  const currentIndex = game.phase === "game-over" ? phases.length : phases.indexOf(game.phase);
  const substep = game.pendingDecision?.type === "monster-movement"
    ? "Choose monster movement"
    : game.pendingDecision?.type === "battle-resolution"
      ? "Choose battle"
      : game.pendingDecision?.type === "attack-target"
        ? "Choose attack target"
        : game.pendingDecision?.type === "retreat"
          ? "Choose retreat"
          : game.pendingDecision?.type === "encounter-resolution"
            ? "Resolve Encounter"
            : game.pendingDecision?.type === "encounter-choice"
              ? "Choose Encounter reward"
              : game.pendingDecision?.type === "trophy-choice"
                ? "Choose trophy"
                : game.pendingDecision?.type === "deployment"
                  ? "Deploy or pass"
                  : game.pendingDecision?.type === "challenge-opponent"
                    ? "Choose Challenge opponent"
                    : game.pendingDecision?.type === "challenge-resolution"
                      ? "Resolve Challenge duel"
                      : game.pendingDecision?.type === "game-over"
                        ? "Match complete"
                        : undefined;

  return (
    <nav className="turn-progress" aria-label="Turn progress">
      <span className="label">TURN {game.round} · PLAYER {game.currentPlayer + 1}</span>
      <ol>
        {phases.map((phase, index) => (
          <li key={phase} className={index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming"}>
            <span aria-hidden="true">{index + 1}</span>
            <strong>{phase}</strong>
          </li>
        ))}
      </ol>
      <p>{game.phase === "game-over" ? "Match complete" : substep ?? `Current step: ${game.phase}`}</p>
    </nav>
  );
}
