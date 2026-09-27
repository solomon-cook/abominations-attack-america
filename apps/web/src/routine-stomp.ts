import { isHexKey, type BoardDefinition, type GameLogEntry, type GameState, type HexKey } from "@abominations/game-engine";

export type RoutineCityStomp = Readonly<{
  playerIndex: number;
  monsterName: string;
  location: HexKey;
  locationName: string;
  dice: number;
  fixedHealth?: number;
  choice?: Readonly<{ healthRoll?: number }>;
}>;

function foughtAtLocationThisTurn(events: readonly GameLogEntry[], endIndex: number, monsterId: string, location: HexKey): boolean {
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.action === "turn.passed") break;
    const battleId = event?.action === "fight.resolved" && event.detail.battleId;
    if (typeof battleId === "string" && battleId.startsWith(`${monsterId}:`) && battleId.endsWith(`:${location}`)) return true;
  }
  return false;
}

function isSimpleCity(board: BoardDefinition | undefined, location: unknown): location is HexKey {
  if (!board || typeof location !== "string" || !isHexKey(location)) return false;
  const features = board.hexes[location]?.features ?? [];
  return features.some((feature) => feature.kind === "city")
    && !features.some((feature) => feature.kind === "mutation-site" || feature.kind === "challenge-site");
}

export function pendingRoutineCityStomp(game: GameState, board: BoardDefinition | undefined): RoutineCityStomp | undefined {
  const decision = game.pendingDecision;
  const encounterResolution = decision?.type === "encounter-resolution" ? decision : undefined;
  const zorbRewardChoice = decision?.type === "encounter-choice" && decision.source === "zorb-city" ? decision : undefined;
  if (game.phase !== "encounter" || (!encounterResolution && !zorbRewardChoice) || game.challenge?.active) return undefined;
  const playerIndex = encounterResolution?.playerIndex ?? zorbRewardChoice!.playerIndex;
  const location = encounterResolution?.location ?? zorbRewardChoice!.location;
  const monster = game.monsters[playerIndex];
  if (!monster || !isSimpleCity(board, location) || game.stompedLocations.includes(location)) return undefined;
  if (foughtAtLocationThisTurn(game.eventLog, game.eventLog.length, monster.id, location)) return undefined;

  const features = board!.hexes[location]!.features;
  const city = features.find((feature) => feature.kind === "city");
  if (!city || city.kind !== "city") return undefined;
  const base = features.find((feature) => feature.kind === "military-base");
  if (encounterResolution && base?.kind === "military-base") {
    if (game.players[playerIndex]?.mutationCardIds.includes("Iron Stomach")) return undefined;
    const trophyAvailable = game.units.some((unit) => unit.branch === base.branch
      && !game.removedUnitIds.includes(unit.id)
      && (unit.location === "record-tile" || isHexKey(unit.location)));
    if (trophyAvailable) return undefined;
  }

  return {
    playerIndex,
    monsterName: monster.name,
    location,
    locationName: board!.hexes[location]!.label ?? location,
    dice: city.benefit.kind === "health-roll" ? city.benefit.dice : 0,
    ...(city.benefit.kind === "health" ? { fixedHealth: city.benefit.amount } : {}),
    ...(zorbRewardChoice ? { choice: { ...(zorbRewardChoice.healthRoll === undefined ? {} : { healthRoll: zorbRewardChoice.healthRoll }) } } : {}),
  };
}

export function isRoutineCityStompEvent(event: GameLogEntry, events: readonly GameLogEntry[], board: BoardDefinition | undefined): boolean {
  if (event.action !== "encounter.resolved" || event.detail.stomped !== true) return false;
  const challenge = event.detail.challenge;
  if (challenge && typeof challenge === "object") {
    const challengeState = challenge as Record<string, unknown>;
    if (challengeState.active === true) return false;
  }
  const location = event.detail.location;
  const monsterId = event.detail.monsterId;
  const playerIndex = event.detail.playerIndex;
  if (typeof monsterId !== "string" || typeof playerIndex !== "number" || !isSimpleCity(board, location)) return false;
  const effects = Array.isArray(event.detail.effects) ? event.detail.effects : [];
  if (!effects.some((effect) => Boolean(effect && typeof effect === "object" && (effect as Record<string, unknown>).type === "stomp"))) return false;
  const mutationDraws = Array.isArray(event.detail.mutationDraws) ? event.detail.mutationDraws : [];
  if (mutationDraws.some((draw) => Boolean(draw && typeof draw === "object" && (draw as Record<string, unknown>).cardDrawn === true))) return false;
  const eventIndex = events.findIndex((candidate) => candidate.id === event.id);
  return !foughtAtLocationThisTurn(events, eventIndex >= 0 ? eventIndex : events.length, monsterId, location);
}
