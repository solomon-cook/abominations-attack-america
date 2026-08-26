import type { GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  action: string;
  canAct: boolean;
  online: boolean;
};

const readableDecision = (value: string) => value
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

/** Board-adjacent attention state derived only from the authoritative snapshot. */
export function AttentionBanner({ game, action, canAct, online }: Props) {
  if (game.phase === "game-over") {
    return <div className="attention-banner complete" role="status" aria-live="polite"><strong>Match complete</strong><span>Review the final result and choose a rematch or return to the lobby.</span></div>;
  }
  const pending = game.pendingDecision;
  if (pending) {
    const owner = pending.type === "trophy-choice" ? pending.playerIndex : game.currentPlayer;
    return (
      <div className={`attention-banner ${canAct ? "action-needed" : "waiting"}`} role="status" aria-live="polite">
        <strong>{canAct ? "Your decision" : `Waiting for Player ${owner + 1}`}</strong>
        <span>{readableDecision(pending.type)} · use the highlighted controls beside the board.</span>
      </div>
    );
  }
  if (!online && action) {
    return <div className="attention-banner" role="status" aria-live="polite"><strong>Player {game.currentPlayer + 1} · {action}</strong><span>Choose a highlighted board action or use the decision controls.</span></div>;
  }
  return null;
}
