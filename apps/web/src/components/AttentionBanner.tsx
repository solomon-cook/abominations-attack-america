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

const eventLabels: Record<string, string> = {
  "monster.moved": "Monster movement accepted",
  "monster.stayed": "Monster stayed in place",
  "unit.moved": "Military movement accepted",
  "unit.deployed": "Military deployment accepted",
  "unit.redeployed": "Military redeployment accepted",
  "fight.resolved": "Combat resolved",
  "retreat.resolved": "Retreat resolved",
  "encounter.resolved": "Encounter resolved",
  "research.drawn": "Research reward recorded",
  "research.used": "Research card resolved",
  "mutation.used": "Mutation card resolved",
  "challenge.resolved": "Monster Challenge resolved",
  "challenge.giant.resolved": "Giant Challenge resolved",
  "monster.disappeared": "Monster disappearance recorded",
  "turn.passed": "Turn advanced",
  "match.conceded": "Match concession recorded",
};

const eventIcons: Record<string, string> = {
  "monster.moved": "↝", "monster.stayed": "↺", "unit.moved": "↝", "unit.deployed": "▣", "unit.redeployed": "↺",
  "fight.resolved": "⚔", "retreat.resolved": "⇱", "encounter.resolved": "✦", "research.drawn": "▤", "research.used": "◆",
  "mutation.used": "◆", "challenge.resolved": "⚔", "challenge.giant.resolved": "⚔", "monster.disappeared": "○",
  "turn.passed": "▶", "match.conceded": "■",
};

/** Board-adjacent attention state derived only from the authoritative snapshot. */
export function AttentionBanner({ game, action, canAct, online }: Props) {
  if (game.phase === "game-over") {
    return <div className="attention-banner complete" role="status" aria-live="polite"><span className="metric-icon" aria-hidden="true">■</span><strong>Match complete</strong><span>Choose a rematch or return to the lobby.</span></div>;
  }
  const pending = game.pendingDecision;
  if (pending) {
    const owner = pending.type === "trophy-choice" ? pending.playerIndex : game.currentPlayer;
    return (
      <div className={`attention-banner ${canAct ? "action-needed" : "waiting"}`} role="status" aria-live="polite">
        <span className="metric-icon" aria-hidden="true">{canAct ? "!" : "…"}</span>
        <strong>{canAct ? "Your decision" : `Waiting for Player ${owner + 1}`}</strong>
        <span>{readableDecision(pending.type)} · use the highlighted controls.</span>
      </div>
    );
  }
  const latestEvent = game.eventLog.at(-1);
  const eventLabel = latestEvent ? eventLabels[latestEvent.action] : undefined;
  if (eventLabel) {
    return <div className="attention-banner event" role="status" aria-live="polite"><span className="metric-icon" aria-hidden="true">{eventIcons[latestEvent?.action ?? ""] ?? "•"}</span><strong>Update</strong><span>{eventLabel}.</span></div>;
  }
  if (!online && action) {
    return <div className="attention-banner" role="status" aria-live="polite"><span className="metric-icon" aria-hidden="true">▶</span><strong>Player {game.currentPlayer + 1} · {action}</strong><span>Choose a highlighted action.</span></div>;
  }
  return null;
}
