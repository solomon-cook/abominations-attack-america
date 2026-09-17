import type { GameState } from "@abominations/game-engine";

type Props = { game: GameState; action: string };

export function MatchStatus({ game, action }: Props) {
  const monster = game.monsters[game.currentPlayer];
  const challenge = game.challenge?.active ? "Active" : game.challenge?.declared ? "Declared" : "Not declared";
  return (
    <section className="status" aria-live="polite" aria-label="Match status">
      <div><span className="label"><span className="metric-icon" aria-hidden="true">↻</span> ROUND</span><strong>{game.round}</strong></div>
      <div><span className="label"><span className="metric-icon" aria-hidden="true">▶</span> ACTIVE PLAYER</span><strong>Player {game.currentPlayer + 1}</strong></div>
      <div><span className="label"><span className="metric-icon" aria-hidden="true">♥</span> ACTIVE MONSTER</span><strong>{game.monsters[game.currentPlayer].name}</strong></div>
      <div><span className="label">PHASE</span><strong>{action}</strong></div>
      <div><span className="label">HEALTH</span><strong>{monster.health} / {monster.maxHealth}</strong></div>
      <div><span className="label">INFAMY</span><strong>{monster.infamy}</strong></div>
      <div><span className="label"><span className="metric-icon" aria-hidden="true">●</span> STOMP MARKERS</span><strong>{game.stompMarkers}</strong></div>
      <div><span className="label"><span className="metric-icon" aria-hidden="true">⚔</span> CHALLENGE</span><strong>{challenge}</strong></div>
    </section>
  );
}
