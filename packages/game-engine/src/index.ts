export type Phase = "move" | "fight" | "encounter" | "deploy" | "game-over";
export type Branch = "Army" | "Navy" | "Air Force" | "Marines";

export interface Monster {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  move: number;
  attacks: number;
  infamy: number;
  location: string;
}

export interface MilitaryUnit {
  id: string;
  branch: Branch;
  health: number;
  defense: number;
  location: string;
}

export interface GameState {
  currentPlayer: number;
  phase: Phase;
  round: number;
  stompMarkers: number;
  monsters: Monster[];
  units: MilitaryUnit[];
  log: string[];
}

export type GameCommand =
  | { type: "move"; destination: string }
  | { type: "advance" };

export interface GameEventResult {
  state: GameState;
  eventType: string;
  eventPayload: Record<string, unknown>;
}

export const locations = [
  { id: "seattle", name: "Seattle", x: 18, y: 20, kind: "city", marker: "1HP", links: ["denver", "san-francisco"] },
  { id: "san-francisco", name: "San Francisco", x: 18, y: 46, kind: "city", marker: "2D", links: ["seattle", "los-angeles"] },
  { id: "denver", name: "Denver", x: 40, y: 35, kind: "base", links: ["seattle", "chicago", "dallas", "los-angeles"] },
  { id: "chicago", name: "Chicago", x: 67, y: 24, kind: "city", marker: "2HP", links: ["denver", "new-york", "dallas"] },
  { id: "new-york", name: "New York", x: 85, y: 30, kind: "city", marker: "1D", links: ["chicago", "miami"] },
  { id: "los-angeles", name: "Los Angeles", x: 18, y: 65, kind: "city", marker: "3D", links: ["seattle", "denver", "dallas"] },
  { id: "infamy-site", name: "Infamy Site", x: 31, y: 55, kind: "infamy", links: ["denver", "dallas"] },
  { id: "dallas", name: "Dallas", x: 48, y: 65, kind: "mutation", links: ["denver", "chicago", "los-angeles", "miami"] },
  { id: "miami", name: "Miami", x: 80, y: 70, kind: "challenge", links: ["dallas", "new-york"] }
] as const;

export const monsters = ["Zorb", "Tomanagi", "Konk", "Megaclaw", "Tox icor", "Gargantis"].map((name, i) => ({
  id: `monster-${i + 1}`, name: name.replace(" ", ""), health: 20, maxHealth: 40, move: 3, attacks: 3, infamy: 0, location: i % 2 ? "seattle" : "los-angeles"
}));

export function createGame(playerCount = 2): GameState {
  const active = monsters.slice(0, Math.max(2, Math.min(playerCount, 4))).map((monster, i) => ({ ...monster, location: i === 0 ? "los-angeles" : "seattle" }));
  return {
    currentPlayer: 0, phase: "move", round: 1, stompMarkers: 10, monsters: active,
    units: ["Army", "Navy", "Air Force", "Marines"].flatMap((branch, branchIndex) =>
      [0, 1].map((i) => ({ id: `${branchIndex}-${i}`, branch: branch as Branch, health: 1, defense: 4, location: ["denver", "chicago", "new-york", "dallas"][branchIndex] }))
    ),
    log: ["Game ready. Choose a destination for the active monster."]
  };
}

export function getLocation(id: string) { return locations.find((location) => location.id === id); }

export function moveMonster(state: GameState, monsterId: string, destination: string): GameState {
  const monster = state.monsters[state.currentPlayer];
  const legal = getLocation(monster.location)?.links.includes(destination as never);
  if (!legal || state.phase !== "move") return state;
  const next = structuredClone(state);
  next.monsters[state.currentPlayer].location = destination;
  next.phase = "fight";
  next.log.unshift(`${monster.name} moved to ${getLocation(destination)?.name}. Fight any units in the space.`);
  return next;
}

export function resolveFight(state: GameState): GameState {
  if (state.phase !== "fight") return state;
  const next = structuredClone(state);
  const monster = next.monsters[next.currentPlayer];
  const targets = next.units.filter((unit) => unit.location === monster.location);
  if (targets.length === 0) next.log.unshift("No battle here. Continue to Encounter.");
  else {
    let rounds = 2;
    for (const target of targets) {
      const roll = Math.floor(Math.random() * 6) + 1;
      if (roll >= target.defense) { next.units = next.units.filter((unit) => unit.id !== target.id); next.log.unshift(`${monster.name} destroyed a ${target.branch} unit (${roll}).`); }
      else next.log.unshift(`${monster.name} missed a ${target.branch} unit (${roll}).`);
      rounds -= 1;
      if (rounds === 0) break;
    }
  }
  next.phase = "encounter";
  return next;
}

export function resolveEncounter(state: GameState): GameState {
  if (state.phase !== "encounter") return state;
  const next = structuredClone(state);
  const monster = next.monsters[next.currentPlayer];
  const place = getLocation(monster.location);
  if (place?.kind === "city") monster.health = Math.min(monster.maxHealth, monster.health + 2);
  if (place?.kind === "infamy") monster.infamy += 2;
  if (place?.kind === "mutation") monster.health = Math.min(monster.maxHealth, monster.health + 1);
  next.stompMarkers = Math.max(0, next.stompMarkers - 1);
  next.log.unshift(`${monster.name} encountered ${place?.name}.`);
  next.phase = "deploy";
  return next;
}

export function deployUnit(state: GameState): GameState {
  if (state.phase !== "deploy") return state;
  const next = structuredClone(state);
  const branch = (["Army", "Navy", "Air Force", "Marines"] as Branch[])[next.currentPlayer % 4];
  const base = locations.find((location) => location.kind === "base")!;
  next.units.push({ id: `deployed-${Date.now()}`, branch, health: 1, defense: 4, location: base.id });
  next.log.unshift(`${branch} deployed a unit to ${base.name}.`);
  next.currentPlayer = (next.currentPlayer + 1) % next.monsters.length;
  if (next.currentPlayer === 0) next.round += 1;
  next.phase = "move";
  return next;
}

/** Apply a client command at the rules boundary. The API should call this function, never mutate state directly. */
export function applyCommand(state: GameState, command: GameCommand): GameEventResult {
  if (command.type === "move") {
    const next = moveMonster(state, state.monsters[state.currentPlayer].id, command.destination);
    if (next === state) throw new Error("That move is not legal in the current phase.");
    return { state: next, eventType: "monster.moved", eventPayload: { destination: command.destination } };
  }
  if (state.phase === "fight") {
    return { state: resolveFight(state), eventType: "fight.resolved", eventPayload: {} };
  }
  if (state.phase === "encounter") {
    return { state: resolveEncounter(state), eventType: "encounter.resolved", eventPayload: {} };
  }
  if (state.phase === "deploy") {
    return { state: deployUnit(state), eventType: "turn.passed", eventPayload: {} };
  }
  throw new Error("There is no advance action available in the current phase.");
}
