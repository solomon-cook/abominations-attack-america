import type { GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  playerIndex: number;
};

export function RevealedCardsPanel({ game, playerIndex }: Props) {
  const player = game.players[playerIndex];
  return (
    <div className="card revealed-card-panel" aria-label={`Revealed cards for Player ${playerIndex + 1}`}>
      <span className="label">REVEALED CARDS</span>
      <p className="card-privacy-note">Face-up cards are shown here. Hidden deck order is never rendered.</p>
      <div className="revealed-card-group">
        <strong>Monster Mutation</strong>
        {player?.mutationCardIds.length ? (
          <ul>{player.mutationCardIds.map((cardId) => <li key={cardId}>{cardId}</li>)}</ul>
        ) : <span className="empty-card-state">None revealed</span>}
      </div>
      <div className="revealed-card-group">
        <strong>Military Research</strong>
        {player?.researchCardIds.length ? (
          <ul>{player.researchCardIds.map((cardId) => <li key={cardId}>{cardId}</li>)}</ul>
        ) : <span className="empty-card-state">None revealed</span>}
      </div>
    </div>
  );
}
