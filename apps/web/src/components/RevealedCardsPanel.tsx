import type { GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  playerIndex: number;
};

export function RevealedCardsPanel({ game, playerIndex }: Props) {
  const player = game.players[playerIndex];
  const revealedMutationCards = player?.mutationCardIds ?? [];
  const revealedResearchCards = player?.researchCardIds ?? [];
  return (
    <div className="card revealed-card-panel" aria-label={`Revealed cards for Player ${playerIndex + 1}`}>
      <span className="label">REVEALED CARDS</span>
      <p className="card-privacy-note">Face-up cards are shown here. Hidden deck order is never rendered.</p>
      <div className="revealed-card-group">
        <strong>Monster Mutation</strong>
        {revealedMutationCards.length ? (
          <>
            <img className="revealed-card-art" src="/assets/cards/monster-mutation-01.webp" alt="Monster Mutation source card artwork" loading="lazy" />
            <ul>{revealedMutationCards.map((cardId) => <li key={cardId}>{cardId}</li>)}</ul>
          </>
        ) : (
          <span className="empty-card-state">None revealed</span>
        )}
      </div>
      <div className="revealed-card-group">
        <strong>Military Research</strong>
        {revealedResearchCards.length ? (
          <>
            <img className="revealed-card-art" src="/assets/cards/military-research-01.webp" alt="Military Research source card artwork" loading="lazy" />
            <ul>{revealedResearchCards.map((cardId) => <li key={cardId}>{cardId}</li>)}</ul>
          </>
        ) : <span className="empty-card-state">None revealed</span>}
      </div>
    </div>
  );
}
