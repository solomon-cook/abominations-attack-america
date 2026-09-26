import { cardDefinition, legalLaserFenceTargets, sourcedCardRule, type GameCommand, type GameState } from "@abominations/game-engine";
import { CardArtwork } from "./DigitalCard";

type Props = {
  game: GameState;
  playerIndex: number;
  canAct: boolean;
  canUseMutation?: boolean;
  runCommand: (command: GameCommand) => void | Promise<void>;
};

export function RevealedCardsPanel({ game, playerIndex, canAct, canUseMutation = canAct, runCommand }: Props) {
  const player = game.players[playerIndex];
  const isActivePlayer = playerIndex === game.currentPlayer;
  const revealedMutationCards = player?.mutationCardIds ?? [];
  const revealedResearchCards = player?.researchCardIds ?? [];
  const pendingBattleId = game.pendingDecision && (game.pendingDecision.type === "battle-resolution" || game.pendingDecision.type === "attack-target")
    ? game.pendingDecision.battleId
    : undefined;
  const pendingBattle = pendingBattleId ? game.pendingBattles.find((battle) => battle.id === pendingBattleId) : undefined;
  const activeMonsterOwnsPendingBattle = pendingBattle?.monsterId === game.monsters[playerIndex]?.id;
  const challengeMutationWindow = game.phase === "challenge" && Boolean(game.challenge?.active && game.challenge.turn
    && (game.challenge.opponentMonsterId || game.challenge.giantUnitId)
    && (game.pendingDecision?.type === "challenge-resolution" || game.pendingDecision?.type === "challenge-giant-resolution")
    && [game.challenge.challengerMonsterId, game.challenge.opponentMonsterId].includes(game.monsters[playerIndex]?.id));
  const mutationBattleId = game.phase === "fight" && activeMonsterOwnsPendingBattle ? pendingBattleId : undefined;
  const hasMutationWindow = Boolean(mutationBattleId || challengeMutationWindow);
  const playableMutation = (cardId: string) => (cardId === "Berserk" || cardId === "Son of a Monster") && hasMutationWindow;
  const canUseDefenseSatellites = canAct && isActivePlayer && game.phase !== "challenge" && game.phase !== "game-over" && game.pendingBattles.length === 0 && !game.pendingRetreat;
  const canStartChopperLift = canAct && isActivePlayer && !game.pendingChopperLift
    && ((game.phase === "move" && game.pendingDecision?.type === "monster-movement")
      || (game.phase === "fight" && game.pendingDecision?.type === "battle-resolution")
      || (game.phase === "encounter" && game.pendingDecision?.type === "encounter-resolution")
      || (game.phase === "deploy" && game.pendingDecision?.type === "deployment"));
  const cardDetails = (cardId: string) => {
    const definition = cardDefinition(cardId);
    const rule = sourcedCardRule(cardId);
    const actionWindow = cardId === "Berserk" || cardId === "Son of a Monster"
      ? "Any time during a battle involving this monster"
      : cardId === "Defense Satellites"
      ? "Move/Fight · pre-battle window"
      : cardId === "Blonde Lure"
        ? "Any turn · choose monster and adjacent destination"
      : cardId === "Mecha-Monster" || cardId === "Captain Colossal"
        ? "Deploy · resolves immediately when drawn"
      : cardId === "X-Fighters"
        ? "Deploy · replace a branch unit with an X-Fighter"
      : cardId === "Cutbacks"
        ? "Any turn · choose a Research card to remove"
      : cardId === "Molecular Cannon"
        ? "Start of your battle · choose a lair for the battling monster"
      : cardId === "Chopper Lift"
        ? "Any turn · roll first, then choose a monster and destination"
      : cardId === "Laser Fence"
        ? legalLaserFenceTargets(game).length > 0 ? "Available now · after a monster ends its move" : "After a monster ends its move, before battle"
      : cardId === "Antimatter" || cardId === "Stabilizer Ray"
          ? cardId === "Stabilizer Ray" ? "Fight · use before battle; choose a Mutation after damage" : "Fight · battle setup window"
          : undefined;
    const directAction = cardId === "Berserk" || cardId === "Son of a Monster"
      ? playableMutation(cardId)
        ? <button type="button" className="hand-card-play" disabled={!canUseMutation} onClick={() => void runCommand({ type: "use-mutation", cardId, ...(mutationBattleId ? { battleId: mutationBattleId } : {}) })}>Play {cardId}</button>
        : undefined
      : cardId === "Defense Satellites"
        ? <button type="button" className="hand-card-play" disabled={!canUseDefenseSatellites} onClick={() => void runCommand({ type: "use-research", cardId: "Defense Satellites" })}>Play Defense Satellites</button>
        : cardId === "Chopper Lift"
          ? <button type="button" className="hand-card-play" disabled={!canStartChopperLift} onClick={() => void runCommand({ type: "use-research", cardId: "Chopper Lift" })}>Roll for Chopper Lift</button>
        : undefined;
    return (
      <details className="hand-card" key={cardId}>
        <summary>{cardId}</summary>
        <div className="hand-card-detail">
          <span>{definition?.availability === "implemented" ? "Implemented in this ruleset" : "Source-gated · unavailable"}</span>
          {rule ? (
            <>
              <CardArtwork cardId={cardId} kind={definition?.deck === "research" ? "research" : "mutation"} />
              {actionWindow && <span className="hand-card-action-status">{cardId === "Berserk" || cardId === "Son of a Monster"
                ? `Playable by this monster's controller: ${actionWindow}`
                : cardId === "Laser Fence" ? `${legalLaserFenceTargets(game).length > 0 ? "Playable now by this card's holder" : "Playable by this card's holder"}: ${actionWindow}`
                : isActivePlayer ? `Playable through current controls: ${actionWindow}` : `Playable by the active player: ${actionWindow}`}</span>}
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
            <div className="hand-card-list">{revealedResearchCards.map(cardDetails)}</div>
          </>
        ) : <span className="empty-card-state">None revealed</span>}
      </div>
    </div>
  );
}
