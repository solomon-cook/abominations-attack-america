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
  const cardAssetSrc = (cardId: string) => {
    const slug = cardId.toLowerCase().replaceAll(" ", "-").replaceAll("!", "").replaceAll("'", "");
    const researchCards = ["Mecha-Monster", "Cutbacks", "Laser Fence", "Guard Commander", "Defense Satellites", "Stabilizer Ray", "Fusion Cells", "X-Fighters", "Molecular Cannon", "2nd Generation", "Blonde Lure", "Anti-Mutagen", "Antimatter", "Scientific Analysis", "Chopper Lift", "Captain Colossal"];
    const mutationCards = ["Fins and Gills", "Rampage", "Radiation Field", "Atomic Recovery", "Berserk", "War Spikes", "Atomic Breath", "Iron Stomach", "Whip Tentacles", "High-Octane Blood", "Son of a Monster", "Winged Horror", "Kinda Friendly", "Laser Beam Eyes", "Armored Scales", "It's a Robot!"];
    return researchCards.includes(cardId)
      ? `/assets/cards/military-research-${slug}.webp`
      : mutationCards.includes(cardId)
        ? `/assets/cards/monster-mutation-${slug}.webp`
        : undefined;
  };
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
              {cardAssetSrc(cardId) && <img className="hand-card-art" src={cardAssetSrc(cardId)} alt={`${cardId} card artwork with sourced rules text`} loading="lazy" />}
              {actionWindow && <span className="hand-card-action-status">{isActivePlayer ? `Playable through current controls: ${actionWindow}` : `Playable by the active player: ${actionWindow}`}</span>}
              {directAction}
              <div className="hand-card-meta" aria-label={`${cardId} rule metadata`}>
                <span>Classification: {rule.classification}</span>
                <span>Timing: {rule.timing}</span>
                <span>Duration: {rule.duration}</span>
                <span>Target and confirmation: {definition?.targets && definition.targets !== "unknown" ? definition.targets : "source-gated"}</span>
                <span>Result: {rule.effectsImplementation === "implemented" ? "shown in the phase log" : "unavailable"}</span>
                <span><span className="metric-icon" aria-hidden="true">◆</span> Status effect: {rule.classification === "persistent" ? "active while held" : "none · resolved through a legal timing window"}</span>
                <span>Source: {rule.sourceRefs.join(", ")}</span>
              </div>
              <strong>{rule.timing}</strong>
              <p className="hand-card-rules-box">{rule.transcription}</p>
              <small>{rule.classification === "persistent" ? "Keep this card face up while its effect applies." : directAction ? "Use this action now." : actionWindow ? "Use the controls for this step." : "Use the phase controls when available."}</small>
            </>
          ) : (
            <p>Rules text is not available yet.</p>
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
