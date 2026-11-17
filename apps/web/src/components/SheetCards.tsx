import { useMemo, useState } from "react";
import { applyCommand, cardDefinition, sourcedCardRule, legalGiantPlacementDestinations, legalMolecularCannonTargets, type GameCommand, type GameState } from "@abominations/game-engine";
import { boardForGame } from "../board-pin";
import { CardArtwork, DigitalCard } from "./DigitalCard";
import { usePlayerNames } from "./player-name-context";

type CardAction = { label: string; command: GameCommand };
export function sheetCardActions(game: GameState, cardId: string, playerName: (index: number) => string = (index) => `Player ${index + 1}`): CardAction[] {
  const board = boardForGame(game);
  const name = (key: string) => board?.hexes[key as `${number},${number}`]?.label ?? key;
  const candidates: CardAction[] = [];
  const decision = game.pendingDecision;
  const battleId = decision?.type === "battle-resolution" || decision?.type === "attack-target" ? decision.battleId : undefined;
  const battle = game.pendingBattles.find((item) => item.id === battleId);
  if (cardId === "Defense Satellites") candidates.push({ label: "Play Defense Satellites", command: { type: "use-research", cardId } });
  if (cardId === "Antimatter" && battleId) candidates.push({ label: "Play Antimatter", command: { type: "use-research", cardId, battleId } });
  if ((cardId === "Berserk" || cardId === "Son of a Monster") && battleId) candidates.push({ label: `Play ${cardId}`, command: { type: "use-mutation", cardId, battleId } });
  if (kindForMonsterCard(game, cardId)) candidates.push({ label: "Gargantis: discard for +3 Health", command: { type: "use-monster-ability", ability: "gargantis-heal", mutationCardIds: [cardId] } });
  if (cardId === "Stabilizer Ray" && battle) candidates.push({ label: "Arm Stabilizer Ray", command: { type: "use-research", cardId, battleId } });
  if (cardId === "Laser Fence" && battle) {
    candidates.push({ label: "Monster pays 2 Infamy", command: { type: "use-research", cardId, battleId, choice: "infamy" } });
    for (const edge of board?.edges.filter((edge) => edge.enabled && edge.from === battle.location) ?? []) candidates.push({ label: `Retreat to ${name(edge.to)}`, command: { type: "use-research", cardId, battleId, choice: "retreat", destination: edge.to } });
  }
  if (cardId === "Blonde Lure") for (const monster of game.monsters) {
    for (const edge of board?.edges.filter((edge) => edge.enabled && edge.from === monster.location) ?? []) candidates.push({ label: `${monster.name} → ${name(edge.to)}`, command: { type: "use-research", cardId, targetMonsterId: monster.id, destination: edge.to } });
  }
  if (cardId === "Cutbacks") game.players.forEach((player, researchPlayerIndex) => {
    const faceUpCards = player.visibleResearchCardIds ?? player.researchCardIds;
    for (const researchCardId of faceUpCards) {
      if (researchCardId !== cardId) candidates.push({
        label: `Remove ${playerName(researchPlayerIndex)}'s ${researchCardId} from play`,
        command: { type: "use-research", cardId, researchCardId, researchPlayerIndex },
      });
    }
  });
  if (cardId === "Molecular Cannon") return legalMolecularCannonTargets(game).map((target) => ({
    label: `Blast ${game.monsters.find((monster) => monster.id === target.targetMonsterId)?.name} to ${name(target.destination)}`,
    command: { type: "use-research", cardId, ...target },
  }));
  if (cardId === "Chopper Lift") candidates.push({ label: "Roll for Chopper Lift", command: { type: "use-research", cardId } });
  if (cardId === "Mecha-Monster" || cardId === "Captain Colossal") for (const destination of legalGiantPlacementDestinations(game)) candidates.push({ label: `Place at ${name(destination)}`, command: { type: "use-research", cardId, destination } });
  // A dry run validates timing and targets using authoritative rules. Its cloned
  // result is discarded; the real command still goes through the normal dispatcher.
  return candidates.filter(({ command }) => {
    // Opponent Research owner arrays are redacted even though their face-up
    // cards are public, so Cutbacks targets must be validated from that public
    // projection instead of a dry-run against the redacted raw array.
    if (cardId === "Cutbacks" && command.type === "use-research") {
      return game.phase === "move" || game.phase === "fight" || game.phase === "encounter" || game.phase === "deploy";
    }
    try { applyCommand(game, command); return true; } catch { return false; }
  });
}

function kindForMonsterCard(game: GameState, cardId: string): boolean {
  const activeMonster = game.monsters[game.currentPlayer];
  return activeMonster?.name === "Gargantis"
    && game.phase !== "challenge"
    && game.phase !== "game-over"
    && game.players[game.currentPlayer]?.mutationCardIds.includes(cardId) === true;
}

function researchEffectSummary(text: string | undefined): string {
  if (!text) return "Effect details unavailable.";
  let effect = text.replace(/\s+/g, " ").trim();
  const discardMarker = "DISCARD THIS CARD AFTER USE.";
  const discardAt = effect.indexOf(discardMarker);
  if (discardAt >= 0) effect = effect.slice(discardAt + discardMarker.length).trim();
  else if (effect.startsWith("Use ")) {
    const firstSentenceEnd = effect.indexOf(". ");
    if (firstSentenceEnd >= 0) effect = effect.slice(firstSentenceEnd + 2);
  }
  const sentences = effect.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [effect];
  return sentences.slice(0, 2).join(" ").trim();
}

function HeldCard({ game, cardId, kind, canPlay, runCommand, onDeploy, playerName }: { game: GameState; cardId: string; kind: "mutation" | "research"; canPlay: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; onDeploy?: (sheet?: string) => void; playerName: (index: number) => string }) {
  const [selected, setSelected] = useState("");
  const rule = sourcedCardRule(cardId);
  const implemented = cardDefinition(cardId)?.availability === "implemented";
  const actions = useMemo(() => canPlay && implemented ? sheetCardActions(game, cardId, playerName) : [], [game, cardId, canPlay, implemented, playerName]);
  const chosen = actions.find((action) => JSON.stringify(action.command) === selected);
  const status = !implemented ? "This card’s action is not implemented yet."
    : rule?.classification === "persistent" ? "Active while held · no play action needed."
    : rule?.classification === "conditional" ? "Applies automatically when its conditions are met."
    : rule?.classification === "immediate" ? "Resolves automatically when received."
    : !canPlay ? "Play on your turn when the card’s timing allows."
    : !actions.length ? "No legal play or target at this point in the turn."
    : "Ready to play.";
  if (kind === "research") {
    const passive = rule?.classification === "persistent" || rule?.classification === "conditional";
    const resolvesOnDraw = rule?.classification === "immediate";
    const effectSummary = researchEffectSummary(rule?.transcription);
    return <article className="research-card-row" aria-label={`${cardId} Military Research card`}>
      <CardArtwork cardId={cardId} kind="research" />
      <div className="research-card-copy">
        <header className="research-card-heading"><h4>{cardId}</h4>
          {passive && <span className="research-card-badge research-card-badge-passive">Passive</span>}
          {resolvesOnDraw && <span className="research-card-badge">On draw</span>}
        </header>
        <p className="research-card-effect">{effectSummary}</p>
        {rule && <details className="research-card-details"><summary>Full effect &amp; timing</summary>
          <p>{rule.transcription}</p><small>{rule.timing}</small>
        </details>}
      </div>
      <div className="research-card-controls">
        {actions.length === 1 && <button type="button" disabled={!runCommand} aria-label={actions[0].label} onClick={() => void runCommand?.(actions[0].command)}>Play</button>}
        {actions.length > 1 && <>
          <label className="sr-only" htmlFor={`research-target-${cardId.replaceAll(" ", "-")}`}>Choose target or outcome</label>
          <select id={`research-target-${cardId.replaceAll(" ", "-")}`} aria-label={`${cardId} target or outcome`} value={chosen ? selected : ""} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Choose target…</option>{actions.map((action) => <option key={JSON.stringify(action.command)} value={JSON.stringify(action.command)}>{action.label}</option>)}
          </select>
          <button type="button" disabled={!chosen || !runCommand} onClick={() => chosen && void runCommand?.(chosen.command)}>Play</button>
        </>}
        {!passive && !resolvesOnDraw && !actions.length && <>
          <button type="button" disabled aria-label={`Play ${cardId}`}>Play</button>
          <small>{!implemented ? "Not available" : status}</small>
        </>}
        {cardId === "X-Fighters" && canPlay && game.phase === "deploy" && onDeploy && <button type="button" onClick={() => onDeploy("X-Fighters")}>Deploy</button>}
      </div>
    </article>;
  }
  return <DigitalCard cardId={cardId} kind={kind} className="sheet-held-card" status={status} tabIndex={0}>
    {actions.length === 1 && runCommand && <button type="button" onClick={() => void runCommand(actions[0].command)}>{actions[0].label}</button>}
    {actions.length > 1 && runCommand && <>
      <label>Choose target or outcome<select aria-label={`${cardId} target or outcome`} value={chosen ? selected : ""} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Select…</option>{actions.map((action) => <option key={JSON.stringify(action.command)} value={JSON.stringify(action.command)}>{action.label}</option>)}
      </select></label>
      <button type="button" disabled={!chosen} onClick={() => chosen && void runCommand(chosen.command)}>Play {cardId}</button>
    </>}
  </DigitalCard>;
}

export function SheetCards({ game, playerIndex, kind, canAct = false, runCommand, onDeploy }: { game: GameState; playerIndex: number; kind: "mutation" | "research"; canAct?: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; onDeploy?: (sheet?: string) => void }) {
  const names = usePlayerNames();
  const playerName = (index: number) => names[index] ?? "Unknown player";
  const cards = game.players[playerIndex]?.[kind === "mutation" ? "mutationCardIds" : "researchCardIds"] ?? [];
  return <section className="sheet-held-cards" aria-label={kind === "mutation" ? "Your Mutation cards" : "Your Military Research cards"}>
    <h3>{kind === "mutation" ? "Monster Mutation" : "Military Research"} · {cards.length}</h3>
    {!cards.length ? <p>No {kind === "mutation" ? "Mutation" : "Military Research"} cards held.</p> : <div className="sheet-held-card-grid">{cards.map((cardId) => <HeldCard key={cardId} game={game} cardId={cardId} kind={kind} canPlay={canAct && playerIndex === game.currentPlayer} runCommand={runCommand} onDeploy={onDeploy} playerName={playerName} />)}</div>}
  </section>;
}
