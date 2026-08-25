import type { Branch } from "./index.js";

export type SetupStartingChoice =
  | Readonly<{ kind: "research" }>
  | Readonly<{ kind: "deploy"; unitId: string; destination: string }>;

export type SetupAction =
  | Readonly<{ type: "choose-monster"; monsterId: string }>
  | Readonly<{ type: "choose-branch"; branch: Branch }>
  | Readonly<{ type: "choose-lair"; lair: string }>
  | Readonly<{ type: "choose-starting-choice"; startingChoice: SetupStartingChoice }>;

export interface SetupDefinition {
  readonly playerCount: 2 | 3 | 4;
  /** Supplied by the verified component catalogue; no fallback roster is inferred here. */
  readonly monsterIds: readonly string[];
  /** Supplied by the verified component catalogue; National Guard is intentionally excluded. */
  readonly eligibleBranches: readonly Branch[];
  /** Supplied by the verified board definition. */
  readonly lairsByMonster: Readonly<Record<string, readonly string[]>>;
}

export interface SetupSeat {
  readonly playerIndex: number;
  readonly monsterId?: string;
  readonly branch?: Branch;
  readonly lair?: string;
  readonly startingChoice?: SetupStartingChoice;
  readonly ready: boolean;
}

export interface SetupState {
  readonly definition: SetupDefinition;
  readonly seats: readonly SetupSeat[];
  readonly phase: "monster-selection" | "branch-selection" | "lair-selection" | "starting-choice" | "complete";
}

/** Explicit fixture used by local/online development play only. */
export const DEVELOPMENT_SETUP_DEFINITION: SetupDefinition = {
  playerCount: 4,
  monsterIds: ["monster-1", "monster-2", "monster-3", "monster-4"],
  eligibleBranches: ["Army", "Navy", "Air Force", "Marines"],
  lairsByMonster: {
    "monster-1": ["los-angeles", "seattle", "denver"],
    "monster-2": ["chicago", "new-york", "miami"],
    "monster-3": ["san-francisco", "dallas", "infamy-site"],
    "monster-4": ["denver", "dallas", "los-angeles"]
  }
};

export function developmentSetupDefinition(playerCount: 2 | 3 | 4): SetupDefinition {
  return {
    ...DEVELOPMENT_SETUP_DEFINITION,
    playerCount,
    monsterIds: DEVELOPMENT_SETUP_DEFINITION.monsterIds.slice(0, playerCount),
    eligibleBranches: DEVELOPMENT_SETUP_DEFINITION.eligibleBranches.slice(0, playerCount),
    lairsByMonster: Object.fromEntries(DEVELOPMENT_SETUP_DEFINITION.monsterIds.slice(0, playerCount).map((id) => [id, DEVELOPMENT_SETUP_DEFINITION.lairsByMonster[id]]) )
  };
}

function seat(state: SetupState, playerIndex: number): SetupSeat {
  const selected = state.seats.find((candidate) => candidate.playerIndex === playerIndex);
  if (!selected) throw new Error(`Unknown setup seat ${playerIndex}.`);
  return selected;
}

function replaceSeat(state: SetupState, nextSeat: SetupSeat): SetupState {
  return { ...state, seats: state.seats.map((candidate) => candidate.playerIndex === nextSeat.playerIndex ? nextSeat : candidate) };
}

function nextUnassigned(state: SetupState, field: keyof Pick<SetupSeat, "monsterId" | "branch" | "lair" | "startingChoice">, reverse = false): SetupSeat | undefined {
  const seats = [...state.seats].sort((a, b) => reverse ? b.playerIndex - a.playerIndex : a.playerIndex - b.playerIndex);
  return seats.find((candidate) => candidate[field] === undefined);
}

export function createSetup(definition: SetupDefinition): SetupState {
  if (![2, 3, 4].includes(definition.playerCount)) throw new Error("A production match must have exactly 2, 3, or 4 players.");
  if (definition.monsterIds.length < definition.playerCount) throw new Error("The verified monster catalogue has too few entries for this match.");
  if (new Set(definition.monsterIds).size !== definition.monsterIds.length) throw new Error("The setup monster catalogue contains duplicates.");
  if (new Set(definition.eligibleBranches).size !== definition.eligibleBranches.length) throw new Error("The setup branch catalogue contains duplicates.");
  for (const monsterId of definition.monsterIds.slice(0, definition.playerCount)) {
    const lairs = definition.lairsByMonster[monsterId] ?? [];
    if (lairs.length !== 3 || new Set(lairs).size !== 3) throw new Error(`Monster ${monsterId} must have exactly three distinct verified lairs.`);
  }
  return {
    definition,
    seats: Array.from({ length: definition.playerCount }, (_, playerIndex) => ({ playerIndex, ready: false })),
    phase: "monster-selection"
  };
}

export function chooseMonster(state: SetupState, playerIndex: number, monsterId: string): SetupState {
  if (state.phase !== "monster-selection") throw new Error("Monster selection is not the current setup step.");
  if (nextUnassigned(state, "monsterId")?.playerIndex !== playerIndex) throw new Error("Monster selection must follow the ordered setup turn.");
  if (!state.definition.monsterIds.includes(monsterId)) throw new Error(`Monster ${monsterId} is not in the verified setup catalogue.`);
  if (state.seats.some((candidate) => candidate.monsterId === monsterId)) throw new Error(`Monster ${monsterId} has already been claimed.`);
  const next = replaceSeat(state, { ...seat(state, playerIndex), monsterId });
  return nextUnassigned(next, "monsterId") ? next : { ...next, phase: "branch-selection" };
}

export function chooseBranch(state: SetupState, playerIndex: number, branch: Branch): SetupState {
  if (state.phase !== "branch-selection") throw new Error("Branch selection is not the current setup step.");
  if (nextUnassigned(state, "branch", true)?.playerIndex !== playerIndex) throw new Error("Branch selection must follow reverse seat order.");
  if (!state.definition.eligibleBranches.includes(branch)) throw new Error(`Branch ${branch} is not eligible for player selection.`);
  if (state.seats.some((candidate) => candidate.branch === branch)) throw new Error(`Branch ${branch} has already been claimed.`);
  const next = replaceSeat(state, { ...seat(state, playerIndex), branch });
  return nextUnassigned(next, "branch", true) ? next : { ...next, phase: "lair-selection" };
}

export function chooseLair(state: SetupState, playerIndex: number, lair: string): SetupState {
  if (state.phase !== "lair-selection") throw new Error("Lair selection is not the current setup step.");
  const current = seat(state, playerIndex);
  if (!current.monsterId || !state.definition.lairsByMonster[current.monsterId]?.includes(lair)) throw new Error(`Lair ${lair} is not valid for this monster.`);
  if (state.seats.some((candidate) => candidate.lair === lair)) throw new Error(`Lair ${lair} has already been claimed.`);
  const next = replaceSeat(state, { ...current, lair });
  return nextUnassigned(next, "lair") ? next : { ...next, phase: "starting-choice" };
}

export function chooseStartingChoice(state: SetupState, playerIndex: number, startingChoice: SetupStartingChoice): SetupState {
  if (state.phase !== "starting-choice") throw new Error("Starting choice is not the current setup step.");
  const current = seat(state, playerIndex);
  if (current.startingChoice) throw new Error(`Player ${playerIndex} already chose a starting option.`);
  const next = replaceSeat(state, { ...current, startingChoice, ready: true });
  return nextUnassigned(next, "startingChoice") ? next : { ...next, phase: "complete" };
}

export function validateSetup(state: SetupState): void {
  if (state.phase !== "complete") throw new Error("Setup is not complete.");
  const monsterIds = state.seats.map((candidate) => candidate.monsterId);
  const branches = state.seats.map((candidate) => candidate.branch);
  const lairs = state.seats.map((candidate) => candidate.lair);
  if (monsterIds.some((value) => !value) || new Set(monsterIds).size !== state.seats.length) throw new Error("Every player needs one distinct monster.");
  if (branches.some((value) => !value) || new Set(branches).size !== state.seats.length) throw new Error("Every player needs one distinct eligible branch.");
  if (lairs.some((value) => !value) || new Set(lairs).size !== state.seats.length) throw new Error("Every player needs one distinct lair.");
  if (state.seats.some((candidate) => !candidate.startingChoice || !candidate.ready)) throw new Error("Every player must confirm a starting choice.");
}

export function applySetupAction(state: SetupState, playerIndex: number, action: SetupAction): SetupState {
  if (action.type === "choose-monster") return chooseMonster(state, playerIndex, action.monsterId);
  if (action.type === "choose-branch") return chooseBranch(state, playerIndex, action.branch);
  if (action.type === "choose-lair") return chooseLair(state, playerIndex, action.lair);
  return chooseStartingChoice(state, playerIndex, action.startingChoice);
}
