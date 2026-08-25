import type { GameState } from "@abominations/game-engine";

type Props = { game: GameState; action: string };

export function MatchStatus({ game, action }: Props) {
  return (
    <section className="status" aria-live="polite" aria-label="Match status">
      <div><span className="label">ROUND</span><strong>{game.round}</strong></div>
      <div><span className="label">ACTIVE MONSTER</span><strong>{game.monsters[game.currentPlayer].name}</strong></div>
      <div><span className="label">PHASE</span><strong>{action}</strong></div>
      <div><span className="label">STOMP MARKERS</span><strong>{game.stompMarkers}</strong></div>
    </section>
  );
}
