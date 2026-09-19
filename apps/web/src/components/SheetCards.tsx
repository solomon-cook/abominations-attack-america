import { useMemo, useState } from "react";
import { applyCommand, cardDefinition, sourcedCardRule, legalGiantPlacementDestinations, type GameCommand, type GameState } from "@abominations/game-engine";
import { boardForGame } from "../board-pin";
import { DigitalCard } from "./DigitalCard";

type CardAction = { label: string; command: GameCommand };
export function sheetCardActions(game: GameState, cardId: string): CardAction[] {
  const board = boardForGame(game);
  const name = (key: string) => board?.hexes[key as `${number},${number}`]?.label ?? key;
  const candidates: CardAction[] = [];
  const decision = game.pendingDecision;
  const battleId = decision?.type === "battle-resolution" || decision?.type === "attack-target" ? decision.battleId : undefined;
  const battle = game.pendingBattles.find((item) => item.id === battleId);
  if (cardId === "Defense Satellites") candidates.push({ label: "Play Defense Satellites", command: { type: "use-research", cardId } });
  if (cardId === "Antimatter" && battleId) candidates.push({ label: "Play Antimatter", command: { type: "use-research", cardId, battleId } });
  if ((cardId === "Berserk" || cardId === "Son of a Monster") && battleId) candidates.push({ label: `Play ${cardId}`, command: { type: "use-mutation", cardId, battleId } });
  if (cardId === "Stabilizer Ray" && battle) {
    const owner = game.monsters.findIndex((monster) => monster.id === battle.monsterId);
    for (const mutationCardId of game.players[owner]?.mutationCardIds ?? []) candidates.push({ label: `Target ${mutationCardId}`, command: { type: "use-research", cardId, battleId, mutationCardId } });
  }
  if (cardId === "Laser Fence" && battle) {
    candidates.push({ label: "Monster pays 2 Infamy", command: { type: "use-research", cardId, battleId, choice: "infamy" } });
    for (const edge of board?.edges.filter((edge) => edge.enabled && edge.from === battle.location) ?? []) candidates.push({ label: `Retreat to ${name(edge.to)}`, command: { type: "use-research", cardId, battleId, choice: "retreat", destination: edge.to } });
  }
  if (cardId === "Blonde Lure") for (const monster of game.monsters) {
    for (const edge of board?.edges.filter((edge) => edge.enabled && edge.from === monster.location) ?? []) candidates.push({ label: `${monster.name} → ${name(edge.to)}`, command: { type: "use-research", cardId, targetMonsterId: monster.id, destination: edge.to } });
  }
  if (cardId === "Mecha-Monster" || cardId === "Captain Colossal") for (const destination of legalGiantPlacementDestinations(game)) candidates.push({ label: `Place at ${name(destination)}`, command: { type: "use-research", cardId, destination } });
  // A dry run validates timing and targets using authoritative rules. Its cloned
  // result is discarded; the real command still goes through the normal dispatcher.
  return candidates.filter(({ command }) => {
    try { applyCommand(game, command); return true; } catch { return false; }
  });
}

function HeldCard({ game, cardId, kind, canPlay, runCommand, onDeploy }: { game: GameState; cardId: string; kind: "mutation" | "research"; canPlay: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; onDeploy?: (sheet?: string) => void }) {
  const [selected, setSelected] = useState("");
  const rule = sourcedCardRule(cardId);
  const implemented = cardDefinition(cardId)?.availability === "implemented";
  const actions = useMemo(() => canPlay && implemented ? sheetCardActions(game, cardId) : [], [game, cardId, canPlay, implemented]);
  const chosen = actions.find((action) => JSON.stringify(action.command) === selected);
  const status = !implemented ? "This card’s action is not implemented yet."
    : rule?.classification === "persistent" ? "Active while held · no play action needed."
    : rule?.classification === "conditional" ? "Applies automatically when its conditions are met."
    : rule?.classification === "immediate" ? "Resolves automatically when received."
    : !canPlay ? "Play on your turn when the card’s timing allows."
    : !actions.length ? "No legal play or target at this point in the turn."
    : "Ready to play.";
  return <DigitalCard cardId={cardId} kind={kind} className="sheet-held-card" status={status} tabIndex={0}>
    {actions.length === 1 && runCommand && <button type="button" onClick={() => void runCommand(actions[0].command)}>{actions[0].label}</button>}
    {actions.length > 1 && runCommand && <>
      <label>Choose target or outcome<select aria-label={`${cardId} target or outcome`} value={chosen ? selected : ""} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Select…</option>{actions.map((action) => <option key={JSON.stringify(action.command)} value={JSON.stringify(action.command)}>{action.label}</option>)}
      </select></label>
      <button type="button" disabled={!chosen} onClick={() => chosen && void runCommand(chosen.command)}>Play {cardId}</button>
    </>}
    {cardId === "X-Fighters" && canPlay && game.phase === "deploy" && onDeploy && <button type="button" onClick={() => onDeploy("X-Fighters")}>Choose an X-Fighter to deploy</button>}
  </DigitalCard>;
}

export function SheetCards({ game, playerIndex, kind, canAct = false, runCommand, onDeploy }: { game: GameState; playerIndex: number; kind: "mutation" | "research"; canAct?: boolean; runCommand?: (command: GameCommand) => void | Promise<void>; onDeploy?: (sheet?: string) => void }) {
  const cards = game.players[playerIndex]?.[kind === "mutation" ? "mutationCardIds" : "researchCardIds"] ?? [];
  return <section className="sheet-held-cards" aria-label={kind === "mutation" ? "Your Mutation cards" : "Your Military Research cards"}>
    <h3>{kind === "mutation" ? "Monster Mutation" : "Military Research"} · {cards.length}</h3>
    {!cards.length ? <p>No {kind === "mutation" ? "Mutation" : "Military Research"} cards held.</p> : <div className="sheet-held-card-grid">{cards.map((cardId) => <HeldCard key={cardId} game={game} cardId={cardId} kind={kind} canPlay={canAct && playerIndex === game.currentPlayer} runCommand={runCommand} onDeploy={onDeploy} />)}</div>}
  </section>;
}
