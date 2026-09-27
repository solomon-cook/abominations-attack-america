import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isHexKey, type BattleAttack, type BoardDefinition, type GameLogEntry, type GameState } from "@abominations/game-engine";
import { DieCube } from "./DieCube";
import { isRoutineCityStompEvent, type RoutineCityStomp } from "../routine-stomp";
import { militaryArt, readBattleAttacks } from "./combat-presentation";
import { monsterPortrait } from "./ResolutionStage";

type Props = {
  matchId: string;
  events: readonly GameLogEntry[];
  monsters: GameState["monsters"];
  units: GameState["units"];
  board?: BoardDefinition;
  enabled: boolean;
  botPlayback?: boolean;
  spectator: boolean;
  viewerPlayerIndex?: number;
  reducedMotion: boolean;
  routineStomp?: RoutineCityStomp;
  canResolveRoutineStomp?: boolean;
  onResolveRoutineStomp?: () => void;
  onResolveRoutineStompChoice?: (choice: "health" | "infamy") => void;
};

type BoardEvent = GameLogEntry & { detail: Record<string, unknown> };
type Position = { x: number; y: number; above: boolean };
type Reward = { type: string; amount: number; source?: string };
type MutationDraw = { cardDrawn: boolean; siteId?: string };

function numberList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry)) : [];
}

function rewardList(value: unknown): Reward[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Reward => Boolean(entry && typeof entry === "object" && typeof entry.type === "string" && typeof entry.amount === "number"));
}

function mutationDrawList(value: unknown): MutationDraw[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is MutationDraw => Boolean(entry && typeof entry === "object" && typeof entry.cardDrawn === "boolean"));
}

function eventPlayerIndex(event: GameLogEntry): number | undefined {
  return typeof event.detail.playerIndex === "number" && Number.isInteger(event.detail.playerIndex) ? event.detail.playerIndex : undefined;
}

function isBoardPresentationEvent(event: GameLogEntry): event is BoardEvent {
  return event.action === "encounter.resolved"
    || event.action === "encounter.choice-required"
    || event.action === "trophy.choice-required"
    || event.action === "research.drawn";
}

export function isCompactBotBattle(event: GameLogEntry, botPlayback: boolean, viewerPlayerIndex?: number): boolean {
  const owner = eventPlayerIndex(event);
  const isBattleStep = event.action === "fight.resolved" || event.action === "battle.target-required";
  return isBattleStep && botPlayback && viewerPlayerIndex !== undefined && owner !== undefined && owner !== viewerPlayerIndex;
}

export function newBattleAttacks(event: GameLogEntry, events: readonly GameLogEntry[]): BattleAttack[] {
  const attacks = readBattleAttacks(event.detail.attacks);
  const eventIndex = events.findIndex((candidate) => candidate.id === event.id);
  if (eventIndex < 0) return attacks;
  const previous = [...events.slice(0, eventIndex)].reverse().find((candidate) =>
    (candidate.action === "fight.resolved" || candidate.action === "battle.target-required")
    && candidate.detail.battleId === event.detail.battleId
    && Array.isArray(candidate.detail.attacks));
  const previousCount = previous ? readBattleAttacks(previous.detail.attacks).length : 0;
  return attacks.slice(Math.min(previousCount, attacks.length));
}

function battleOutcome(attack: BattleAttack): { kind: string; label: string } {
  if (!attack.hit) return { kind: "is-miss", label: "MISS" };
  if (attack.targetHealthBefore !== undefined && attack.targetHealthAfter !== undefined) {
    const lost = Math.max(0, attack.targetHealthBefore - attack.targetHealthAfter);
    return { kind: attack.destroyed ? "is-destroyed" : "is-hit", label: `−${lost} ♥${attack.destroyed ? " · DEFEATED" : ""}` };
  }
  return { kind: attack.destroyed ? "is-destroyed" : "is-hit", label: `−${attack.damage}${attack.destroyed ? " · DESTROYED" : " DAMAGE"}` };
}

export function BoardEventPlayback({ matchId, events, monsters, units, board, enabled, botPlayback = false, spectator, viewerPlayerIndex, reducedMotion, routineStomp, canResolveRoutineStomp = false, onResolveRoutineStomp, onResolveRoutineStompChoice }: Props) {
  const initialized = useRef(false);
  const initializedMatch = useRef(matchId);
  const seenEvents = useRef(new Set<string>());
  const [queue, setQueue] = useState<BoardEvent[]>([]);
  const [shownDice, setShownDice] = useState(0);
  const [shownAttack, setShownAttack] = useState<{ eventId: string; index: number }>();
  const [outcomeEventId, setOutcomeEventId] = useState<string>();
  const [position, setPosition] = useState<Position>();
  const playbackRef = useRef<HTMLDivElement>(null);
  const current = queue[0];
  const rolls = useMemo(() => current ? numberList(current.detail.rolls) : [], [current]);
  const attacks = useMemo(() => current && (current.action === "fight.resolved" || current.action === "battle.target-required") ? newBattleAttacks(current, events) : [], [current, events]);
  const effects = useMemo(() => current ? rewardList(current.detail.effects) : [], [current]);
  const mutationDraws = useMemo(() => current ? mutationDrawList(current.detail.mutationDraws) : [], [current]);
  const playerIndex = current ? eventPlayerIndex(current) : undefined;
  const playerName = playerIndex === undefined ? "Monster" : monsters[playerIndex]?.name ?? "Monster";
  const isResearchDraw = current?.action === "research.drawn";
  const isFightPlayback = current?.action === "fight.resolved" || current?.action === "battle.target-required";
  const shownAttackIndex = current && shownAttack?.eventId === current.id ? shownAttack.index : -1;
  const currentAttack = shownAttackIndex >= 0 ? attacks[shownAttackIndex] : undefined;
  const showOutcome = current?.id === outcomeEventId;
  const currentAttackOutcome = currentAttack ? battleOutcome(currentAttack) : undefined;
  const researchCardDrawn = isResearchDraw;
  const cards = isResearchDraw
    ? researchCardDrawn ? [{ kind: "research", label: "MILITARY RESEARCH" }] : []
    : mutationDraws.filter((draw) => draw.cardDrawn).map(() => ({ kind: "mutation", label: "MONSTER MUTATION" }));
  const requestedLocation = current && (typeof current.detail.location === "string" ? current.detail.location : typeof current.detail.destination === "string" ? current.detail.destination : undefined);
  const fallbackLocation = playerIndex === undefined ? undefined : monsters[playerIndex]?.location;
  const locationKey = requestedLocation && isHexKey(requestedLocation) && board?.hexes[requestedLocation]
    ? requestedLocation
    : fallbackLocation && isHexKey(fallbackLocation) ? fallbackLocation : undefined;
  const presentationLocationKey = current ? locationKey : routineStomp?.location;
  const locationName = current ? locationKey ? board?.hexes[locationKey]?.label : undefined : routineStomp?.locationName;
  const outcomeText = isFightPlayback
    ? current?.action === "fight.resolved" ? "Battle resolved" : "Next attack"
    : current?.action === "encounter.choice-required"
    ? "Choosing encounter reward…"
    : Boolean(current?.detail.challenge && typeof current.detail.challenge === "object" && (current.detail.challenge as Record<string, unknown>).declared === true)
      ? "Monster Challenge declared"
    : !effects.length && !cards.length
      ? "Encounter complete"
      : undefined;
  const isRoutineStompPlayback = current ? isRoutineCityStompEvent(current, events, board) : false;
  const combatant = (id: string) => {
    const monster = monsters.find((candidate) => candidate.id === id);
    if (monster) return { name: monster.name, image: monsterPortrait(monster.name), kind: "monster" as const };
    const unit = units.find((candidate) => candidate.id === id);
    if (unit) return { name: (unit.unitTypeId ?? unit.branch).replaceAll("-", " "), image: militaryArt(unit.unitTypeId), kind: "unit" as const };
    return { name: id.replaceAll("-", " "), image: undefined, kind: "unknown" as const };
  };

  useEffect(() => {
    if (!initialized.current || initializedMatch.current !== matchId) {
      initialized.current = true;
      initializedMatch.current = matchId;
      seenEvents.current = new Set(events.map((event) => `${matchId}:${event.id}`));
      setQueue([]);
      return;
    }
    const fresh = events.filter((event) => {
      const key = `${matchId}:${event.id}`;
      if (seenEvents.current.has(key)) return false;
      seenEvents.current.add(key);
      return true;
    });
    if (!enabled) return;
    const presentations = fresh.filter((event): event is BoardEvent => {
      if (!isBoardPresentationEvent(event) && event.action !== "fight.resolved" && event.action !== "battle.target-required") return false;
      const owner = eventPlayerIndex(event);
      if (isCompactBotBattle(event, botPlayback, viewerPlayerIndex)) return newBattleAttacks(event, events).length > 0;
      if (event.action === "fight.resolved" || event.action === "battle.target-required") return false;
      if (!isBoardPresentationEvent(event)) return false;
      return owner !== undefined && (spectator || owner !== viewerPlayerIndex || isRoutineCityStompEvent(event, events, board));
    });
    if (presentations.length) setQueue((existing) => [...existing, ...presentations]);
  }, [board, botPlayback, enabled, events, matchId, spectator, viewerPlayerIndex]);

  useEffect(() => {
    if (!current) return;
    let timer: number;
    let revealed = 0;
    setShownDice(0);
    setShownAttack(undefined);
    setOutcomeEventId(undefined);
    const finish = () => {
      setOutcomeEventId(current.id);
      timer = window.setTimeout(() => setQueue((existing) => existing.slice(1)), reducedMotion ? 1500 : isFightPlayback || current.action === "battle.target-required" ? 520 : current.action === "encounter.choice-required" ? 3400 : 2700);
    };
    if (isFightPlayback && attacks.length > 0) {
      let attackIndex = -1;
      const revealAttack = () => {
        attackIndex += 1;
        setShownAttack({ eventId: current.id, index: attackIndex });
        if (attackIndex < attacks.length - 1) timer = window.setTimeout(revealAttack, reducedMotion ? 0 : 720);
        else timer = window.setTimeout(finish, reducedMotion ? 0 : 680);
      };
      timer = window.setTimeout(revealAttack, reducedMotion ? 0 : 130);
    } else if (reducedMotion || rolls.length === 0) {
      setShownDice(rolls.length);
      timer = window.setTimeout(finish, reducedMotion ? 0 : 220);
    } else {
      const revealNext = () => {
        revealed += 1;
        setShownDice(revealed);
        if (revealed < rolls.length) timer = window.setTimeout(revealNext, 430);
        else timer = window.setTimeout(finish, 380);
      };
      timer = window.setTimeout(revealNext, 150);
    }
    return () => window.clearTimeout(timer);
  }, [attacks.length, current?.id, isFightPlayback, reducedMotion, rolls.length]);

  useEffect(() => {
    if (!current && !routineStomp) return;
    let frame = 0;
    let previous = "";
    const place = () => {
      const tiles = document.querySelectorAll<HTMLElement>(".hex-tile[data-hex-key]");
      const tile = [...tiles].find((candidate) => candidate.dataset.hexKey === presentationLocationKey);
      const rect = tile?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        frame = requestAnimationFrame(place);
        return;
      }
      const width = playbackRef.current?.getBoundingClientRect().width || Math.min(286, window.innerWidth - 20);
      const height = playbackRef.current?.getBoundingClientRect().height || (routineStomp ? 170 : 140);
      const x = Math.max(width / 2 + 10, Math.min(window.innerWidth - width / 2 - 10, rect.left + rect.width / 2));
      const above = rect.bottom + height + 16 > window.innerHeight - 72;
      const y = above ? Math.max(58, rect.top - 8) : rect.bottom + 8;
      const next = { x, y, above };
      const signature = `${Math.round(x)}:${Math.round(y)}:${above}`;
      if (signature !== previous) {
        previous = signature;
        setPosition(next);
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [current?.id, presentationLocationKey, Boolean(routineStomp)]);

  if ((!current && !routineStomp) || !position || typeof document === "undefined") return null;
  const visibleRolls = rolls.slice(0, shownDice);
  const attacker = currentAttack ? combatant(currentAttack.attackerId) : undefined;
  const target = currentAttack ? combatant(currentAttack.targetId) : undefined;
  const labels = [playerName, locationName, ...effects.map((effect) => `${effect.type} ${effect.amount > 0 ? "+" : ""}${effect.amount}`), ...cards.map((card) => card.label)].filter(Boolean);
  const prompt = !current ? routineStomp : undefined;
  return createPortal(<div
    ref={playbackRef}
    className={`board-event-playback${position.above ? " is-above" : ""}${reducedMotion ? " reduced-motion" : ""}${prompt ? " is-interactive" : ""}`}
    style={{ left: `${position.x}px`, top: `${position.y}px` }}
    data-event-action={current?.action ?? "encounter.pending"}
    data-roll-count={visibleRolls.length}
    data-outcome-visible={showOutcome}
    data-card-count={showOutcome ? cards.length : 0}
    role={prompt ? "group" : "status"}
    aria-live={prompt ? undefined : "polite"}
    aria-label={prompt
      ? `${prompt.monsterName} ${prompt.choice ? `must choose a reward at ${prompt.locationName}` : `is ready to stomp ${prompt.locationName}${prompt.dice ? `; roll ${prompt.dice} city dice` : ""}`}`
      : `${playerName}'s ${isFightPlayback ? "battle playback" : isResearchDraw ? "Military Research draw" : isRoutineStompPlayback ? "city stomp" : "Encounter"}${locationName ? ` at ${locationName}` : ""}: ${labels.join(", ")}`}
    data-event-id={current?.id}
  >
    {prompt ? <>
      <header className="board-event-heading"><span><small>PLAYER {prompt.playerIndex + 1} · CITY STOMP</small><strong>{prompt.monsterName}</strong></span><small className="board-event-location">{prompt.locationName}</small></header>
      {prompt.choice ? <>
        <p className="board-event-prompt-copy">{prompt.choice.healthRoll === undefined ? "Choose the city reward" : `City roll · +${prompt.choice.healthRoll} Health`}</p>
        <div className="board-event-choice-actions" aria-label="Choose the city reward">
          <button type="button" disabled={!canResolveRoutineStomp || !onResolveRoutineStompChoice} onClick={() => onResolveRoutineStompChoice?.("health")}>Take {prompt.choice.healthRoll === undefined ? "Health" : `${prompt.choice.healthRoll} Health`}</button>
          <button type="button" disabled={!canResolveRoutineStomp || !onResolveRoutineStompChoice} onClick={() => onResolveRoutineStompChoice?.("infamy")}>Take 2 Infamy</button>
        </div>
      </> : prompt.dice > 0
        ? <div className="board-event-prompt-dice" aria-label={`${prompt.dice} city dice ready to roll`}>{Array.from({ length: prompt.dice }, (_, index) => <span key={index} aria-hidden="true">⚄</span>)}</div>
        : <p className="board-event-prompt-copy">{prompt.fixedHealth ? `City benefit · +${prompt.fixedHealth} Health` : "City benefit ready"}</p>}
      {!prompt.choice && <button className="board-event-roll-all" type="button" disabled={!canResolveRoutineStomp} onClick={onResolveRoutineStomp}>
        {prompt.dice > 0 ? `Roll all ${prompt.dice} dice` : "Resolve city stomp"}
        {prompt.dice > 0 && <span aria-hidden="true"> ⚄</span>}
      </button>}
    </> : current ? <>
      <header className="board-event-heading"><span><small>PLAYER {playerIndex === undefined ? "?" : playerIndex + 1} · {isFightPlayback ? "BOT BATTLE" : isResearchDraw ? "RESEARCH" : isRoutineStompPlayback ? "CITY STOMP" : "ENCOUNTER"}</small><strong>{isFightPlayback ? "Battle in progress" : playerName}</strong></span>{locationName && <small className="board-event-location">{locationName}</small>}</header>
      {isFightPlayback && currentAttack && attacker && target && <div key={`${current.id}-${shownAttackIndex}`} className="board-battle-step" role="group" aria-label={`Attack ${shownAttackIndex + 1} of ${attacks.length}`} data-attack-index={shownAttackIndex}>
        <BattleActor actor={attacker} side="attacker" />
        <div className="board-battle-roll"><small>ATTACK</small><span aria-hidden="true">⚄</span><DieCube value={currentAttack.roll} label={`Attack roll ${currentAttack.roll}`} /></div>
        <BattleActor actor={target} side="target" />
        {currentAttackOutcome && <p className={`board-battle-result ${currentAttackOutcome.kind}`}>{currentAttackOutcome.label}</p>}
      </div>}
      {!isFightPlayback && rolls.length > 0 && <div className="board-event-dice" aria-label={`${shownDice} of ${rolls.length} dice revealed`}>
        {visibleRolls.map((roll, index) => <span className="board-event-die" key={`${current.id}-die-${index}`}><DieCube value={roll} label={`Encounter die ${index + 1}: ${roll}`} /></span>)}
      </div>}
      {showOutcome && <div className="board-event-outcome">
        {effects.map((effect, index) => {
          const kind = effect.type === "health" ? effect.amount < 0 ? "health-loss" : "health-gain" : effect.type === "infamy" ? "infamy" : effect.type === "stomp" ? "stomp" : "other";
          const icon = effect.type === "health" ? "♥" : effect.type === "infamy" ? "🔥" : effect.type === "stomp" ? "●" : "✦";
          const amount = effect.amount > 0 ? `+${effect.amount}` : String(effect.amount).replace("-", "−");
          const label = effect.type === "stomp" ? "Stomp" : effect.type === "infamy" ? "Infamy" : "Health";
          return <div className={`board-event-reward ${kind}`} key={`${current.id}-effect-${index}`}><span aria-hidden="true">{icon}</span><strong>{effect.type === "stomp" ? "+" : amount}</strong><small>{label}</small></div>;
        })}
        {cards.map((card, index) => <div className={`board-event-card ${card.kind}`} key={`${current.id}-card-${index}`} aria-label={`${card.label} card drawn`}><span aria-hidden="true">+</span><small>{card.label}</small></div>)}
        {outcomeText && <span className="board-event-note">{outcomeText}</span>}
      </div>}
    </> : null}
  </div>, document.body);
}

function BattleActor({ actor, side }: { actor: { name: string; image?: string; kind: "monster" | "unit" | "unknown" }; side: "attacker" | "target" }) {
  return <div className={`board-battle-actor ${actor.kind} ${side}`}>
    <span className="board-battle-avatar">{actor.image ? <img src={actor.image} alt="" /> : <span aria-hidden="true">{actor.kind === "monster" ? "◉" : "⚔"}</span>}</span>
    <strong>{actor.name}</strong>
  </div>;
}
