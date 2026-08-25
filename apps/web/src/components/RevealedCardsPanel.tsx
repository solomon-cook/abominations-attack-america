import { cardDefinition, sourcedCardRule, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  playerIndex: number;
};

export function RevealedCardsPanel({ game, playerIndex }: Props) {
  const player = game.players[playerIndex];
  const revealedMutationCards = player?.mutationCardIds ?? [];
  const revealedResearchCards = player?.researchCardIds ?? [];
  const cardDetails = (cardId: string) => {
    const definition = cardDefinition(cardId);
    const rule = sourcedCardRule(cardId);
    return (
      <details className="hand-card" key={cardId}>
        <summary>{cardId}</summary>
        <div className="hand-card-detail">
          <span>{definition?.availability === "implemented" ? "Implemented in this ruleset" : "Source-gated · unavailable"}</span>
          {rule ? <><strong>{rule.timing}</strong><p>{rule.transcription}</p></> : <p>Detailed timing and source text are not yet transcribed into the digital rules reference.</p>}
        </div>
      </details>
    );
  };
  return (
    <div className="card revealed-card-panel" aria-label={`Private hand for Player ${playerIndex + 1}`}>
      <span className="label">YOUR HAND</span>
      <p className="card-privacy-note">Your held cards are shown here. Hidden deck order and other players' hands are never rendered.</p>
      <div className="revealed-card-group">
        <strong>Monster Mutation</strong>
        {revealedMutationCards.length ? (
          <>
            <img className="revealed-card-art" src="/assets/cards/monster-mutation-01.webp" alt="Monster Mutation source card artwork" loading="lazy" />
            <div className="hand-card-list">{revealedMutationCards.map(cardDetails)}</div>
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
            <div className="hand-card-list">{revealedResearchCards.map(cardDetails)}</div>
          </>
        ) : <span className="empty-card-state">None revealed</span>}
      </div>
    </div>
  );
}
