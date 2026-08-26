import { cardDefinition, sourcedCardRule, type GameCommand, type GameState } from "@abominations/game-engine";

type Props = {
  game: GameState;
  playerIndex: number;
  canAct: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
};

export function RevealedCardsPanel({ game, playerIndex, canAct, runCommand }: Props) {
  const player = game.players[playerIndex];
  const isActivePlayer = playerIndex === game.currentPlayer;
  const revealedMutationCards = player?.mutationCardIds ?? [];
  const revealedResearchCards = player?.researchCardIds ?? [];
  const pendingBattleId = game.pendingDecision && (game.pendingDecision.type === "battle-resolution" || game.pendingDecision.type === "attack-target")
    ? game.pendingDecision.battleId
    : undefined;
  const pendingBattle = pendingBattleId ? game.pendingBattles.find((battle) => battle.id === pendingBattleId) : undefined;
  const activeMonsterOwnsPendingBattle = pendingBattle?.monsterId === game.monsters[playerIndex]?.id;
  const canUseMutation = canAct && isActivePlayer && game.phase === "fight" && Boolean(activeMonsterOwnsPendingBattle);
  const canUseDefenseSatellites = canAct && isActivePlayer && game.phase !== "challenge" && game.phase !== "game-over" && game.pendingBattles.length === 0 && !game.pendingRetreat;
  const cardDetails = (cardId: string) => {
    const definition = cardDefinition(cardId);
    const rule = sourcedCardRule(cardId);
    const actionWindow = cardId === "Berserk" || cardId === "Son of a Monster"
      ? "Fight · optional Mutation window"
      : cardId === "Defense Satellites"
      ? "Move/Fight · pre-battle window"
      : cardId === "Blonde Lure"
        ? "Any turn · choose monster and adjacent destination"
      : cardId === "Mecha-Monster" || cardId === "Captain Colossal"
        ? "Deploy · resolves immediately when drawn"
      : cardId === "X-Fighters"
        ? "Deploy · replace a branch unit with an X-Fighter"
      : cardId === "Antimatter" || cardId === "Stabilizer Ray" || cardId === "Laser Fence"
          ? "Fight · battle setup window"
          : undefined;
    const directAction = cardId === "Berserk" || cardId === "Son of a Monster"
      ? canUseMutation && pendingBattleId
        ? <button type="button" className="hand-card-play" disabled={!canUseMutation} onClick={() => void runCommand({ type: "use-mutation", cardId, battleId: pendingBattleId })}>Play {cardId}</button>
        : undefined
      : cardId === "Defense Satellites"
        ? <button type="button" className="hand-card-play" disabled={!canUseDefenseSatellites} onClick={() => void runCommand({ type: "use-research", cardId: "Defense Satellites" })}>Play Defense Satellites</button>
        : undefined;
    return (
      <details className="hand-card" key={cardId}>
        <summary>{cardId}</summary>
        <div className="hand-card-detail">
          <span>{definition?.availability === "implemented" ? "Implemented in this ruleset" : "Source-gated · unavailable"}</span>
          {rule ? (
            <>
              {actionWindow && <span className="hand-card-action-status">{isActivePlayer ? `Playable through current controls: ${actionWindow}` : `Playable by the active player: ${actionWindow}`}</span>}
              {directAction}
              <div className="hand-card-meta" aria-label={`${cardId} rule metadata`}>
                <span>Classification: {rule.classification}</span>
                <span>Timing: {rule.timing}</span>
                <span>Duration: {rule.duration}</span>
                <span>Target and confirmation: {definition?.targets && definition.targets !== "unknown" ? definition.targets : "source-gated"}</span>
                <span>Result: {rule.effectsImplementation === "implemented" ? "authoritative result shown in the phase log" : "source-gated"}</span>
                <span>Persistent effect: {rule.classification === "persistent" ? "active while held" : "no · resolved through a legal timing window"}</span>
                <span>Source: {rule.sourceRefs.join(", ")}</span>
              </div>
              <strong>{rule.timing}</strong>
              <p>{rule.transcription}</p>
              <small>{rule.classification === "persistent" ? "Keep this card face up while its sourced continuous effect applies." : directAction ? "This direct action is legal in the current authoritative window." : actionWindow ? "Use the matching authoritative action in the current decision controls; the hand never issues an independent command." : "When this card is usable, the authoritative phase controls provide its legal target and confirmation."}</small>
            </>
          ) : (
            <p>Detailed timing, target, confirmation, result, and source text are not yet transcribed into the digital rules reference.</p>
          )}
        </div>
      </details>
    );
  };
  return (
    <div className="card revealed-card-panel" aria-label={`Private hand for Player ${playerIndex + 1}`}>
      <span className="label">YOUR HAND</span>
      <p className="card-privacy-note">Your held cards are shown here. Hidden deck order and other players' hands are never rendered.</p>
      <div className="revealed-card-group">
        <strong><span className="metric-icon" aria-hidden="true">▤</span> Monster Mutation · {revealedMutationCards.length}</strong>
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
        <strong><span className="metric-icon" aria-hidden="true">▤</span> Military Research · {revealedResearchCards.length}</strong>
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
