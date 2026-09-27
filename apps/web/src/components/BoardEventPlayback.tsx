import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isHexKey, type BoardDefinition, type GameLogEntry, type GameState } from "@abominations/game-engine";
import { DieCube } from "./DieCube";
import { isRoutineCityStompEvent, type RoutineCityStomp } from "../routine-stomp";

type Props = {
  matchId: string;
  events: readonly GameLogEntry[];
  monsters: GameState["monsters"];
  board?: BoardDefinition;
  enabled: boolean;
  spectator: boolean;
  viewerPlayerIndex?: number;
  reducedMotion: boolean;
  routineStomp?: RoutineCityStomp;
  canResolveRoutineStomp?: boolean;
  onResolveRoutineStomp?: () => void;
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

function eventPlayerIndex(event: BoardEvent): number | undefined {
  return typeof event.detail.playerIndex === "number" && Number.isInteger(event.detail.playerIndex) ? event.detail.playerIndex : undefined;
}

function isBoardPresentationEvent(event: GameLogEntry): event is BoardEvent {
  return event.action === "encounter.resolved"
    || event.action === "encounter.choice-required"
    || event.action === "trophy.choice-required"
    || event.action === "research.drawn";
}

export function BoardEventPlayback({ matchId, events, monsters, board, enabled, spectator, viewerPlayerIndex, reducedMotion, routineStomp, canResolveRoutineStomp = false, onResolveRoutineStomp }: Props) {
  const initialized = useRef(false);
  const initializedMatch = useRef(matchId);
  const seenEvents = useRef(new Set<string>());
  const [queue, setQueue] = useState<BoardEvent[]>([]);
  const [shownDice, setShownDice] = useState(0);
  const [showOutcome, setShowOutcome] = useState(false);
  const [position, setPosition] = useState<Position>();
  const playbackRef = useRef<HTMLDivElement>(null);
  const current = queue[0];
  const rolls = useMemo(() => current ? numberList(current.detail.rolls) : [], [current]);
  const effects = useMemo(() => current ? rewardList(current.detail.effects) : [], [current]);
  const mutationDraws = useMemo(() => current ? mutationDrawList(current.detail.mutationDraws) : [], [current]);
  const playerIndex = current ? eventPlayerIndex(current) : undefined;
  const playerName = playerIndex === undefined ? "Monster" : monsters[playerIndex]?.name ?? "Monster";
  const isResearchDraw = current?.action === "research.drawn";
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
  const outcomeText = current?.action === "encounter.choice-required"
    ? "Choosing encounter reward…"
    : !effects.length && !cards.length
      ? "Encounter complete"
      : undefined;
  const isRoutineStompPlayback = current ? isRoutineCityStompEvent(current, events, board) : false;

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
      if (!isBoardPresentationEvent(event)) return false;
      const owner = eventPlayerIndex(event);
      return owner !== undefined && (spectator || owner !== viewerPlayerIndex || isRoutineCityStompEvent(event, events, board));
    });
    if (presentations.length) setQueue((existing) => [...existing, ...presentations]);
  }, [board, enabled, events, matchId, spectator, viewerPlayerIndex]);

  useEffect(() => {
    if (!current) return;
    let timer: number;
    let revealed = 0;
    setShownDice(0);
    setShowOutcome(false);
    const finish = () => {
      setShowOutcome(true);
      timer = window.setTimeout(() => setQueue((existing) => existing.slice(1)), reducedMotion ? 1500 : current.action === "encounter.choice-required" ? 3400 : 2700);
    };
    if (reducedMotion || rolls.length === 0) {
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
  }, [current?.id, reducedMotion, rolls.length]);

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
      ? `${prompt.monsterName} is ready to stomp ${prompt.locationName}${prompt.dice ? `; roll ${prompt.dice} city dice` : ""}`
      : `${playerName}'s ${isResearchDraw ? "Military Research draw" : isRoutineStompPlayback ? "city stomp" : "Encounter"}${locationName ? ` at ${locationName}` : ""}: ${labels.join(", ")}`}
    data-event-id={current?.id}
  >
    {prompt ? <>
      <header className="board-event-heading"><span><small>PLAYER {prompt.playerIndex + 1} · CITY STOMP</small><strong>{prompt.monsterName}</strong></span><small className="board-event-location">{prompt.locationName}</small></header>
      {prompt.dice > 0
        ? <div className="board-event-prompt-dice" aria-label={`${prompt.dice} city dice ready to roll`}>{Array.from({ length: prompt.dice }, (_, index) => <span key={index} aria-hidden="true">⚄</span>)}</div>
        : <p className="board-event-prompt-copy">{prompt.fixedHealth ? `City benefit · +${prompt.fixedHealth} Health` : "City benefit ready"}</p>}
      <button className="board-event-roll-all" type="button" disabled={!canResolveRoutineStomp} onClick={onResolveRoutineStomp}>
        {prompt.dice > 0 ? `Roll all ${prompt.dice} dice` : "Resolve city stomp"}
        {prompt.dice > 0 && <span aria-hidden="true"> ⚄</span>}
      </button>
    </> : current ? <>
      <header className="board-event-heading"><span><small>PLAYER {playerIndex === undefined ? "?" : playerIndex + 1} · {isResearchDraw ? "RESEARCH" : isRoutineStompPlayback ? "CITY STOMP" : "ENCOUNTER"}</small><strong>{playerName}</strong></span>{locationName && <small className="board-event-location">{locationName}</small>}</header>
      {rolls.length > 0 && <div className="board-event-dice" aria-label={`${shownDice} of ${rolls.length} dice revealed`}>
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
