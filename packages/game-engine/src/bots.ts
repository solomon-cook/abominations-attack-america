import {
  applyCommand,
  boardForState,
  canUseDefenseSatellites,
  deploymentChoices,
  chooseBranch,
  chooseLair,
  chooseMonster,
  chooseStartingChoice,
  getLocation,
  legalChopperLiftDestinations,
  legalGiantPlacementDestinations,
  legalLaserFenceTargets,
  legalMolecularCannonTargets,
  legalMonsterPaths,
  legalMovementNeighbors,
  legalSubmarineTargets,
  locationIdToHexKey,
  monsters,
  shortestLegalUnitPaths,
  setupDeploymentState,
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupState,
} from "./index.js";

export const BRANCHES = ["Army", "Navy", "Air Force", "Marines"] as const;
export type BotBranch = typeof BRANCHES[number];
export type BotTactic = "force-first" | "research-first";
export type BotTacticOverrides = ReadonlyMap<number, BotTactic>;
export type BotRouteBlockMultiplierOverrides = ReadonlyMap<number, number>;
export type BotResearchDrawGateBypass = "objectiveThreatAbsent" | "blockerOpportunityAbsent";
export type BotResearchDrawGateBypassOverrides = ReadonlyMap<number, ReadonlySet<BotResearchDrawGateBypass>>;

export interface BotResearchDrawGateDiagnostics {
  researchDeckAvailable: boolean;
  deploymentNotStarted: boolean;
  researchHandBelowTwo: boolean;
  researchFirstPolicy: boolean;
  activeMilitaryScreen: boolean;
  objectiveThreatAbsent: boolean;
  blockerOpportunityAbsent: boolean;
}

export interface BotDeployDecisionDiagnostics {
  playerIndex: number;
  path: "optional-research-choice" | "no-deployment-choices" | "priority-giant-placement";
  deploymentChoiceCount: number | null;
  legalResearchDrawAvailable: boolean;
  selectedCommandType: GameCommand["type"];
  gates: BotResearchDrawGateDiagnostics | null;
  eligible: boolean | null;
  /** Present only when an explicit controlled study bypasses a failed urgency gate. */
  bypassedGates?: readonly BotResearchDrawGateBypass[];
}

export type BotDeployDecisionObserver = (diagnostics: BotDeployDecisionDiagnostics) => void;

/** Pick a match-stable, evenly mixed style from the match seed and bot seat. */
export function botTacticForPlayer(state: GameState, playerIndex: number, overrides?: BotTacticOverrides): BotTactic {
  const override = overrides?.get(playerIndex);
  if (override) return override;
  let value = ((state.rng.seed >>> 0) ^ Math.imul(playerIndex + 1, 0x9e3779b1)) >>> 0;
  for (let index = 0; index < state.matchId.length; index += 1) {
    value = Math.imul(value ^ state.matchId.charCodeAt(index), 0x85ebca6b) >>> 0;
    value ^= value >>> 13;
  }
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  return (value & 1) === 0 ? "force-first" : "research-first";
}

const monsterPlans: Record<string, string> = {
  Konk: "Exploit speed to stomp objectives and slip past a prepared blocker.",
  Zorb: "Build Infamy at cities, then spend it to add attacks when the target force is exposed.",
  Megaclaw: "Use its attack strength to break isolated screens; avoid a massed firing line while weakened.",
  Gargantis: "Keep Mutation cards available as healing reserves and recover before a challenge.",
  Toxicor: "Use mobility and mutation pressure; make attackers think twice before launching missiles.",
  Tomanagi: "Contest central objectives, then recover or draw Research rather than feed a prepared line.",
};

const branchPlans: Record<BotBranch, string> = {
  Army: "Use tanks to screen threatened cities and Army bases, with missile launchers one step behind the line.",
  Navy: "Cover coastal cities and Navy bases with fighters; keep submarines near the coast for supported strikes.",
  "Air Force": "Spread fighters across threatened cities and bases; save cruise missiles for a decisive strike.",
  Marines: "Guard the most threatened city approaches with rocket launchers and use fighters as a rapid reserve.",
};

const counterPicks: Record<string, readonly string[]> = {
  Konk: ["Gargantis", "Megaclaw", "Zorb", "Toxicor", "Tomanagi"],
  Zorb: ["Gargantis", "Tomanagi", "Konk", "Megaclaw", "Toxicor"],
  Megaclaw: ["Gargantis", "Toxicor", "Konk", "Tomanagi", "Zorb"],
  Gargantis: ["Toxicor", "Megaclaw", "Zorb", "Konk", "Tomanagi"],
  Toxicor: ["Gargantis", "Megaclaw", "Konk", "Tomanagi", "Zorb"],
  Tomanagi: ["Konk", "Gargantis", "Toxicor", "Megaclaw", "Zorb"],
};

const defaultMonsterPreference = ["Gargantis", "Toxicor", "Megaclaw", "Konk", "Tomanagi", "Zorb"] as const;

const branchCounters: Record<string, readonly BotBranch[]> = {
  Konk: ["Army", "Marines", "Navy", "Air Force"],
  Zorb: ["Marines", "Army", "Air Force", "Navy"],
  Megaclaw: ["Air Force", "Marines", "Army", "Navy"],
  Gargantis: ["Marines", "Air Force", "Army", "Navy"],
  Toxicor: ["Marines", "Army", "Air Force", "Navy"],
  Tomanagi: ["Army", "Marines", "Air Force", "Navy"],
};

function monsterName(monsterId?: string): string | undefined {
  return monsters.find((monster) => monster.id === monsterId)?.name;
}

function hexDistance(state: GameState, left: string, right: string): number {
  const board = boardForState(state);
  const leftKey = board.hexes[left as HexKey] ? left as HexKey : locationIdToHexKey(left);
  const rightKey = board.hexes[right as HexKey] ? right as HexKey : locationIdToHexKey(right);
  const a = leftKey ? board.hexes[leftKey]?.coord : undefined;
  const b = rightKey ? board.hexes[rightKey]?.coord : undefined;
  if (!a || !b) return 99;
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function featureValue(state: GameState, location: HexKey): number {
  const features = boardForState(state).hexes[location]?.features ?? [];
  return features.reduce((value, feature) => value + (feature.kind === "city" ? 4 : feature.kind === "infamy-site" ? 5 : feature.kind === "military-base" ? 2 : 0), 0);
}

function highRollCityRegionBonus(state: GameState, destination: HexKey, monster: GameState["monsters"][number] | undefined): number {
  if (!monster) return 0;
  const healthNeed = Math.max(0, Math.min(1, (monster.maxHealth - monster.health) / Math.max(1, monster.maxHealth)));
  const cityPreference = monster.name === "Megaclaw" ? 0.25 : monster.name === "Toxicor" && monster.health >= 20 ? 0.2 : monster.name === "Zorb" && monster.infamy < 6 ? 1 : healthNeed;
  if (cityPreference <= 0) return 0;
  const board = boardForState(state);
  const nearbyHighRollCities = Object.values(board.hexes).flatMap((hex) => {
    if (state.stompedLocations.includes(hex.key) || hexDistance(state, destination, hex.key) > 6) return [];
    const city = hex.features.find((feature) => feature.kind === "city");
    return city?.benefit.kind === "health-roll" && city.benefit.dice >= 2
      ? [city.benefit.dice * Math.max(0, 6 - hexDistance(state, destination, hex.key)) / 5]
      : [];
  });
  return Math.min(8, nearbyHighRollCities.reduce((sum, value) => sum + value, 0) * 0.8 * cityPreference);
}

function monsterHealthNeed(monster: GameState["monsters"][number]): number {
  return Math.max(0, Math.min(1, (monster.maxHealth - monster.health) / Math.max(1, monster.maxHealth)));
}

function monsterInfamyNeed(monster: GameState["monsters"][number]): number {
  return Math.max(0, Math.min(1, (10 - monster.infamy) / 10));
}

const challengeMutationPriority: Readonly<Record<string, number>> = {
  "High-Octane Blood": 100,
  Berserk: 95,
  "War Spikes": 92,
  "Atomic Breath": 90,
  "Son of a Monster": 88,
  "Whip Tentacles": 84,
  "Armored Scales": 80,
  "It's a Robot!": 74,
  "Atomic Recovery": 45,
  "Radiation Field": 35,
  "Winged Horror": 30,
  "Fins and Gills": 25,
  "Iron Stomach": 20,
  "Laser Beam Eyes": 15,
  Rampage: 10,
  "Kinda Friendly": 5,
};

function selectChallengeMutation(cardIds: readonly string[]): string | undefined {
  return [...cardIds].sort((a, b) => (challengeMutationPriority[b] ?? 0) - (challengeMutationPriority[a] ?? 0))[0];
}

function pickMonsterAgainstRivals(available: readonly string[], rivalNames: readonly string[]): string | undefined {
  const fallbackRank = (name: string) => {
    const rank = defaultMonsterPreference.indexOf(name as typeof defaultMonsterPreference[number]);
    return rank < 0 ? defaultMonsterPreference.length : rank;
  };
  const candidateScore = (monsterId: string) => {
    const candidateName = monsterName(monsterId) ?? monsterId;
    if (rivalNames.length === 0) return fallbackRank(candidateName);
    return rivalNames.reduce((score, rivalName) => {
      const preference = counterPicks[rivalName] ?? defaultMonsterPreference;
      const rank = preference.indexOf(candidateName);
      return score + (rank < 0 ? preference.length : rank);
    }, 0);
  };
  return [...available].sort((left, right) =>
    candidateScore(left) - candidateScore(right)
    || fallbackRank(monsterName(left) ?? left) - fallbackRank(monsterName(right) ?? right)
    || left.localeCompare(right),
  )[0];
}

function preferredBranch(rivalNames: readonly string[], available: readonly string[]): BotBranch {
  const fallback = ["Marines", "Army", "Air Force", "Navy"] as const;
  const candidateScore = (branch: string) => {
    if (rivalNames.length === 0) return fallback.indexOf(branch as typeof fallback[number]);
    return rivalNames.reduce((score, rivalName) => {
      const preference = branchCounters[rivalName] ?? fallback;
      const rank = preference.indexOf(branch as BotBranch);
      return score + (rank < 0 ? preference.length : rank);
    }, 0);
  };
  const picked = [...available].sort((left, right) =>
    candidateScore(left) - candidateScore(right)
    || BRANCHES.indexOf(left as BotBranch) - BRANCHES.indexOf(right as BotBranch)
    || left.localeCompare(right),
  )[0];
  return (picked ?? fallback.find((branch) => available.includes(branch)) ?? available[0] ?? "Army") as BotBranch;
}

function pickLairAwayFromRivals(state: GameState, options: readonly string[], rivalLairs: readonly string[]): string | undefined {
  const separation = (lair: string) => {
    const distances = rivalLairs.map((rivalLair) => hexDistance(state, lair, rivalLair));
    return {
      nearest: distances.length > 0 ? Math.min(...distances) : -1,
      total: distances.reduce((sum, distance) => sum + distance, 0),
    };
  };
  return [...options].sort((left, right) => {
    const leftSeparation = separation(left);
    const rightSeparation = separation(right);
    return rightSeparation.nearest - leftSeparation.nearest
      || rightSeparation.total - leftSeparation.total
      || left.localeCompare(right);
  })[0];
}

/** Complete one setup choice using the same setup transitions and deployment legality as a human. */
export function chooseBotSetupAction(game: GameState, setup: SetupState, playerIndex: number): SetupState {
  if (setup.phase === "monster-selection") {
    const available = setup.definition.monsterIds.filter((id) => !setup.seats.some((seat) => seat.monsterId === id));
    const rivalNames = setup.seats
      .filter((seat) => seat.playerIndex !== playerIndex && seat.monsterId)
      .map((seat) => monsterName(seat.monsterId) ?? "");
    const picked = pickMonsterAgainstRivals(available, rivalNames) ?? available[0];
    return picked ? chooseMonster(setup, playerIndex, picked) : setup;
  }
  if (setup.phase === "branch-selection") {
    const rivalNames = setup.seats
      .filter((seat) => seat.playerIndex !== playerIndex && seat.monsterId)
      .map((seat) => monsterName(seat.monsterId) ?? "");
    const available = setup.definition.eligibleBranches.filter((branch) => !setup.seats.some((seat) => seat.branch === branch));
    return chooseBranch(setup, playerIndex, preferredBranch(rivalNames, available));
  }
  if (setup.phase === "lair-selection") {
    const seat = setup.seats.find((candidate) => candidate.playerIndex === playerIndex);
    const options = setup.definition.lairsByMonster[seat?.monsterId ?? ""]?.filter((lair) => !setup.seats.some((candidate) => candidate.lair === lair)) ?? [];
    const rivalLairs = setup.seats
      .filter((candidate) => candidate.playerIndex !== playerIndex && candidate.lair)
      .map((candidate) => candidate.lair!);
    const picked = pickLairAwayFromRivals(game, options, rivalLairs);
    return picked ? chooseLair(setup, playerIndex, picked) : setup;
  }
  if (setup.phase !== "starting-choice") return setup;
  const preview = setupDeploymentState({ ...game, setupState: setup }, playerIndex);
  let deployState = preview;
  const placements: { unitId: string; destination: HexKey }[] = [];
  const branch = (setup.seats[playerIndex]?.branch ?? "Army") as BotBranch;
  const preferredUnits: Record<BotBranch, readonly string[]> = {
    Army: ["army-tank", "army-missile-launcher"],
    Navy: ["navy-fighter", "navy-nuclear-submarine"],
    "Air Force": ["air-force-fighter"],
    Marines: ["marines-rocket-launcher", "marines-fighter"],
  };
  const maxPlacements = branch === "Marines" ? 3 : 2;
  for (let count = 0; count < maxPlacements && deployState.phase === "deploy"; count += 1) {
    const choices = deploymentChoices(deployState).filter((choice) => choice.kind === "deploy" && choice.sheet === branch);
    const choice = choices.sort((a, b) => {
      const rank = (id: string) => preferredUnits[branch].findIndex((unitType) => id.startsWith(unitType));
      return (rank(a.typeId) < 0 ? 99 : rank(a.typeId)) - (rank(b.typeId) < 0 ? 99 : rank(b.typeId));
    })[0];
    const destination = choice?.destinations.find((key) => !deployState.monsters.some((monster) => monster.location === key));
    if (!choice || !destination) break;
    placements.push({ unitId: choice.id, destination });
    try {
      deployState = applyCommand(deployState, { type: "deploy", unitId: choice.id, destination }).state;
    } catch {
      break;
    }
  }
  return chooseStartingChoice(setup, playerIndex, placements.length ? { kind: "deploy", placements } : { kind: "research" });
}

export function botStrategyHint(monsterName: string, branch: string, tactic?: BotTactic): string {
  const monster = monsterPlans[monsterName] ?? "Pressure objectives while avoiding a fight on the opponent’s terms.";
  const military = branchPlans[branch as BotBranch] ?? branchPlans.Army;
  const style = tactic === "force-first" ? "Force-first: deploy the full roster early and block monster routes."
    : tactic === "research-first" ? "Research-first: draw useful cards early while keeping a small screen in play."
      : "";
  return `${style} ${monster} ${military}`.trim();
}

export function hasBotLaserFenceReaction(state: GameState): boolean {
  const owner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
  return owner > 0 && legalLaserFenceTargets(state).some((target) => target.targetMonsterId !== state.monsters[owner]?.id);
}

function tileScore(state: GameState, destination: HexKey, playerIndex: number, branch: BotBranch, monsterTurn: boolean): number {
  const board = boardForState(state);
  const hex = board.hexes[destination];
  const location = getLocation(destination);
  const features = hex?.features ?? [];
  let score = 0;
  const monster = monsterTurn ? state.monsters[playerIndex] : undefined;
  const objectiveAvailable = !state.stompedLocations.includes(destination);
  const city = objectiveAvailable ? features.find((feature) => feature.kind === "city") : undefined;
  if (city) {
    if (monsterTurn && monster?.name === "Toxicor") {
      const healing = city.benefit.kind === "health" ? city.benefit.amount : city.benefit.dice * 3.5;
      score += monster.health < 20 ? 15 + healing : 5;
    } else {
      const healthNeed = monster ? monsterHealthNeed(monster) : 0;
      score += monsterTurn
        ? monster?.name === "Zorb" && monster.infamy < 6 ? 9 + Math.max(0, 3 - monster.infamy) * 2 + healthNeed * 4 : 2 + healthNeed * 11
        : 1;
    }
    if (monsterTurn && city.benefit.kind === "health-roll" && city.benefit.dice >= 2) {
      const cityPreference = monster ? monster.name === "Megaclaw" ? 0.25 : monster.name === "Toxicor" && monster.health >= 20 ? 0.2 : monster.name === "Zorb" && monster.infamy < 6 ? 1 : monsterHealthNeed(monster) : 0;
      score += city.benefit.dice * 2 * cityPreference;
    }
  }
  if (objectiveAvailable && features.some((feature) => feature.kind === "infamy-site")) {
    const infamyNeed = monster ? monsterInfamyNeed(monster) : 0;
    score += monsterTurn ? 4 + infamyNeed * 8 + (monster?.name === "Megaclaw" ? 5 : 0) : 0;
  }
  if (monsterTurn && monster && objectiveAvailable) {
    const infamyNeed = monsterInfamyNeed(monster);
    for (const feature of features) {
      if (feature.kind !== "military-base") continue;
      const baseOwner = state.setupAssignments?.findIndex((seat) => seat.branch === feature.branch) ?? -1;
      const rivalBase = baseOwner >= 0 && baseOwner !== playerIndex;
      score += rivalBase ? 7 + infamyNeed * 7 : 2 + infamyNeed * 2;
    }
  } else if (features.some((feature) => feature.kind === "military-base")) {
    score += monsterTurn ? 0 : 4;
  }
  if (features.some((feature) => feature.kind === "lair")) score += monsterTurn ? 0 : 2;
  if (location?.name === "Hollywood") score += monsterTurn ? 3 : 1;
  if (monsterTurn && monster?.name === "Toxicor") {
    const unusedMutationSites = features.filter((feature) => feature.kind === "mutation-site" && !(state.mutationSiteUses[monster.id] ?? []).includes(feature.siteId)).length;
    score += unusedMutationSites * (monster.health >= 20 ? 20 : 4);
  } else if (monsterTurn && monster && !state.decks.mutation.exhausted && state.round <= 3 && monsterHealthNeed(monster) <= 0.25) {
    const unusedMutationSites = features.filter((feature) => feature.kind === "mutation-site" && !(state.mutationSiteUses[monster.id] ?? []).includes(feature.siteId)).length;
    const mutationsHeld = state.players[playerIndex]?.mutationCardIds.length ?? 0;
    score += unusedMutationSites * Math.max(0, 11 - mutationsHeld * 3);
  }
  if (monsterTurn) score += highRollCityRegionBonus(state, destination, monster);

  const enemies = state.monsters.filter((candidate, index) => index !== playerIndex && candidate.health > 0 && candidate.location === destination);
  const friendlyUnits = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location === destination);
  const hostileUnits = state.units.filter((unit) => unit.ownerPlayer !== undefined && unit.ownerPlayer !== playerIndex && unit.location === destination);
  if (monsterTurn) {
    const prioritizesHealth = Boolean(monster && (monsterHealthNeed(monster) > 0.25
      || monster.name === "Toxicor" && monster.health < 20
      || monster.name === "Zorb" && monster.infamy < 6));
    const unusedMutationSites = Boolean(monster && !state.decks.mutation.exhausted && state.round <= 3 && monsterHealthNeed(monster) <= 0.25)
      || Boolean(monster?.name === "Toxicor" && monster.health >= 20);
    const nextObjectiveDistance = Object.values(board.hexes)
      .filter((candidate) => !state.stompedLocations.includes(candidate.key) && candidate.features.some((feature) => feature.kind === "infamy-site" || feature.kind === "military-base"
        || prioritizesHealth && feature.kind === "city"
        || unusedMutationSites && feature.kind === "mutation-site" && monster && !(state.mutationSiteUses[monster.id] ?? []).includes(feature.siteId)))
      .reduce((nearest, candidate) => Math.min(nearest, hexDistance(state, destination, candidate.key)), 99);
    score += Math.max(0, 5 - nextObjectiveDistance) * 2;
    const danger = hostileUnits.reduce((sum, unit) => sum + unit.damage + (unit.unitTypeId?.includes("missile") ? 2 : 0), 0);
    if (monster?.name === "Tomanagi" && (hex?.waterClass === "sea" || hex?.waterClass === "seacoast")) score += 8;
    if (monster?.name === "Konk") score += hostileUnits.filter((unit) => unit.unitTypeId?.includes("fighter")).length * 2;
    score += enemies.length * (monster?.health && monster.health > 8 ? 6 : -3);
    score -= monster && monster.health < 7 ? danger * 2 : danger * 0.45;
    if (monster?.name === "Gargantis" && monster.health < 15) score -= danger;
  } else {
    score += enemies.length * (branch === "Army" || branch === "Marines" ? 8 : 6);
    score += friendlyUnits.length * (branch === "Army" ? 1.2 : 0.5);
    if (branch === "Army" && enemies.length === 0) score += features.some((feature) => feature.kind === "city") ? 4 : 0;
    if ((branch === "Air Force" || branch === "Navy") && hostileUnits.length > 0) score -= hostileUnits.length * 0.6;
  }
  return score;
}

function bestPath(paths: HexKey[][], score: (destination: HexKey) => number): HexKey[] | undefined {
  return [...paths].sort((a, b) => score(b.at(-1)!) - score(a.at(-1)!) || a.length - b.length)[0];
}

function nearestTargetScore(state: GameState, destination: HexKey, playerIndex: number, branch: BotBranch, routeScores?: ReadonlyMap<HexKey, number>, unitTypeId = ""): number {
  const board = boardForState(state);
  const location = board.hexes[destination];
  const threats = state.monsters.filter((monster, index) => index !== playerIndex && monster.health > 0 && typeof monster.location === "string");
  if (!location) return 0;
  const protectionScores = routeScores ?? routeBlockScores(state, playerIndex, branch);
  const routeBlocking = protectionScores.get(destination) ?? 0;
  const roleBonus = militaryRoleBonus(state, destination, branch, unitTypeId, routeBlocking);
  if (!threats.length) return tileScore(state, destination, playerIndex, branch, false) + routeBlocking + roleBonus;
  const focus = focusTarget(state, playerIndex, branch);
  if (!focus) return tileScore(state, destination, playerIndex, branch, false) + routeBlocking + roleBonus;
  const distance = hexDistance(state, destination, focus.location);
  const pressure = (branch === "Army" || branch === "Marines" ? 3.2 : 2.6) * Math.max(0, 9 - distance);
  const blocker = distance <= 2 && focus.infamy >= 2 ? 6 : 0;
  const focusWounded = focus.health < 8 ? 5 : 0;
  const nearbyForce = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location !== "record-tile" && unit.location !== "permanently-removed" && hexDistance(state, unit.location, focus.location) <= 2).length;
  const massing = Math.max(0, 3 - nearbyForce) * (distance <= 2 ? 3 : 1.2);
  const attackedMonster = threats.find((monster) => monster.location === destination);
  const forceAtEngagement = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location === destination).length + 1;
  const prematureAttack = attackedMonster && !(attackedMonster.health <= 5 && forceAtEngagement >= 3) ? -35 : 0;
  return pressure + blocker + focusWounded + massing + routeBlocking + prematureAttack + tileScore(state, destination, playerIndex, branch, false);
}

function focusTarget(state: GameState, playerIndex: number, branch: BotBranch) {
  const board = boardForState(state);
  return state.monsters.filter((monster, index) => index !== playerIndex && monster.health > 0 && board.hexes[monster.location as HexKey])
    .map((monster) => {
      const distanceToObjective = Object.values(board.hexes)
        .filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site") && !state.stompedLocations.includes(hex.key))
        .reduce((nearest, hex) => Math.min(nearest, hexDistance(state, monster.location, hex.key)), 99);
      const forceNearby = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location !== "record-tile" && hexDistance(state, unit.location, monster.location) <= 1).reduce((sum, unit) => sum + unit.damage, 0);
      let matchup = 0;
      if (branch === "Navy" && monster.name === "Toxicor" && monster.health > 6) matchup -= 8;
      if (branch === "Air Force" && monster.name === "Toxicor" && monster.health > 6) matchup -= 5;
      if (branch === "Marines" && ["Zorb", "Megaclaw"].includes(monster.name)) matchup += 3;
      const urgentObjective = Math.max(0, monster.move + 1 - distanceToObjective) * 2;
      return { monster, score: monster.infamy * 2 + (monster.health < 8 ? 7 : 0) + urgentObjective + forceNearby * 1.2 + matchup };
    })
    .sort((a, b) => b.score - a.score)[0]?.monster;
}

/** Military positions along threatened city, branch-base, and Infamy routes gain defensive value. */
export function routeBlockScores(
  state: GameState,
  actor = state.currentPlayer,
  branch = (state.setupAssignments?.[actor]?.branch ?? "Army") as BotBranch,
  tacticOverrides?: BotTacticOverrides,
  routeBlockMultiplierOverride?: number,
): Map<HexKey, number> {
  const scores = new Map<HexKey, number>();
  const board = boardForState(state);
  const forceFirst = botTacticForPlayer(state, actor, tacticOverrides) === "force-first";
  // Preserve the existing tactic-derived multiplier unless a controlled
  // experiment explicitly overrides this actor's route-block policy.
  const routeBlockMultiplier = routeBlockMultiplierOverride ?? (forceFirst ? 1.15 : 0.9);
  if (!Number.isFinite(routeBlockMultiplier) || routeBlockMultiplier < 0) {
    throw new RangeError("Route-block multiplier must be a finite non-negative number.");
  }
  const goals = Object.values(board.hexes).filter((hex) => !state.stompedLocations.includes(hex.key)
    && hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site" || feature.kind === "military-base"));
  for (const [monsterIndex, monster] of state.monsters.entries()) {
    // This player should block rival monsters from objectives, not obstruct
    // the monster they control from reaching those same objectives.
    if (monsterIndex === actor) continue;
    const start = monster.location as HexKey;
    if (monster.health <= 0 || !board.hexes[start]) continue;
    const movement = monster.movement;
    if (!legalMovementNeighbors(board, movement, start).length) continue;
    const distance = new Map<HexKey, number>([[start, 0]]);
    const previous = new Map<HexKey, HexKey>();
    const queue: HexKey[] = [start];
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]!;
      const steps = distance.get(current)!;
      if (steps >= 10) continue;
      for (const next of legalMovementNeighbors(board, movement, current)) {
        if (distance.has(next)) continue;
        distance.set(next, steps + 1);
        previous.set(next, current);
        queue.push(next);
      }
    }
    for (const goal of goals) {
      if (goal.key === start) continue;
      const steps = distance.get(goal.key);
      if (steps === undefined) continue;
      const path: HexKey[] = [];
      let current = goal.key;
      while (current !== start) {
        path.push(current);
        const parent = previous.get(current);
        if (!parent) break;
        current = parent;
      }
      if (current !== start) continue;
      path.reverse();
      const city = goal.features.some((feature) => feature.kind === "city");
      const ownBase = goal.features.some((feature) => feature.kind === "military-base" && feature.branch === branch);
      const value = (city ? 13 : 0) + (ownBase ? 10 : goal.features.some((feature) => feature.kind === "military-base") ? 7 : 4);
      const defenders = state.units.filter((unit) => unit.ownerPlayer === actor && unit.location !== "record-tile" && unit.location !== "permanently-removed" && hexDistance(state, unit.location, goal.key) <= 1).length;
      const coverage = defenders === 0 ? 1 : defenders === 1 ? 0.7 : 0.5;
      const turnsAway = Math.ceil(steps / Math.max(1, monster.move));
      const urgency = turnsAway <= 1 ? 1 : turnsAway === 2 ? 0.75 : 0.5;
      path.forEach((key, index) => {
        const toGoal = steps - index - 1;
        const approach = Math.max(0, 4 - toGoal) * 2;
        const pressure = (value * urgency + approach) * coverage * routeBlockMultiplier;
        scores.set(key, Math.max(scores.get(key) ?? 0, pressure));
      });
    }
  }
  return scores;
}

function militaryRoleBonus(state: GameState, destination: HexKey, branch: BotBranch, unitTypeId: string, routeScore: number): number {
  if (routeScore < 8) return 0;
  const hex = boardForState(state).hexes[destination];
  const threatenedBase = hex?.features.some((feature) => feature.kind === "military-base" && feature.branch === branch) ?? false;
  const threatenedCity = hex?.features.some((feature) => feature.kind === "city") ?? false;
  const threatenedCoast = hex?.waterClass === "sea" || hex?.waterClass === "seacoast";
  if (branch === "Army") return unitTypeId === "army-tank" ? 3 : unitTypeId === "army-missile-launcher" ? 1 : 0;
  if (branch === "Navy") return unitTypeId === "navy-fighter" && threatenedCoast ? 4 : unitTypeId === "navy-nuclear-submarine" && threatenedCoast ? 3 : 0;
  if (branch === "Air Force") return unitTypeId === "air-force-fighter" ? 3 : unitTypeId === "air-force-cruise-missile" && (threatenedCity || threatenedBase) ? -4 : 0;
  return unitTypeId === "marines-rocket-launcher" ? 4 : unitTypeId === "marines-fighter" ? 2 : 0;
}

function exposedCityBonus(state: GameState, destination: HexKey, actor: number): number {
  const hex = boardForState(state).hexes[destination];
  const city = hex?.features.find((feature) => feature.kind === "city");
  if (!city) return 0;
  const cityValue = city.benefit.kind === "health-roll" ? city.benefit.dice : 1;
  const nearbyDefenders = state.units.filter((unit) => unit.ownerPlayer === actor
    && unit.location !== "record-tile" && unit.location !== "permanently-removed"
    && hexDistance(state, unit.location, destination) <= 1).length;
  return cityValue * 3 / (nearbyDefenders + 1);
}

function retreatCommand(state: GameState): GameCommand {
  const retreat = state.pendingRetreat!;
  const destinations: Record<string, HexKey | "disappeared"> = {};
  for (const unitId of retreat.unitIds) {
    const options = retreat.options[unitId] ?? [];
    const monster = state.monsters.find((candidate) => candidate.id === unitId);
    const owner = monster ? state.monsters.indexOf(monster) : state.units.find((unit) => unit.id === unitId)?.ownerPlayer ?? state.currentPlayer;
    destinations[unitId] = options.length
      ? [...options].sort((a, b) => tileScore(state, b, owner, (state.setupAssignments?.[owner]?.branch ?? "Army") as BotBranch, Boolean(monster)) - tileScore(state, a, owner, (state.setupAssignments?.[owner]?.branch ?? "Army") as BotBranch, Boolean(monster)))[0]!
      : "disappeared";
  }
  return { type: "retreat", destinations };
}

function shouldDrawResearch(state: GameState, actor: number, branch: BotBranch, choices: ReturnType<typeof deploymentChoices>, routeScores: ReadonlyMap<HexKey, number>, tacticOverrides?: BotTacticOverrides, gateBypasses?: ReadonlySet<BotResearchDrawGateBypass>): boolean {
  if (state.decks.research.exhausted || state.deploymentsThisTurn > 0) return false;
  const hand = state.players[actor]?.researchCardIds ?? [];
  if (hand.length >= 2) return false;
  const units = state.units.filter((unit) => unit.ownerPlayer === actor && unit.location !== "record-tile" && unit.location !== "permanently-removed");
  const focus = focusTarget(state, actor, branch);
  const objectiveDistance = focus ? Object.values(boardForState(state).hexes)
    .filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site") && !state.stompedLocations.includes(hex.key))
    .reduce((nearest, hex) => Math.min(nearest, hexDistance(state, focus.location, hex.key)), 99) : 99;
  const objectiveThreat = Boolean(focus && objectiveDistance <= focus.move + 1 && (focus.infamy >= 2 || objectiveDistance <= 1));
  const researchFirst = botTacticForPlayer(state, actor, tacticOverrides) === "research-first";
  if (!researchFirst) return false;
  const blockerOpportunity = choices.some((choice) => choice.destinations.some((destination) => (routeScores.get(destination) ?? 0) >= 10));
  // Research-first bots draw once they have a screen in play; force-first bots
  // keep using every legal deployment before drawing any optional Research.
  return units.length >= 1
    && (!objectiveThreat || gateBypasses?.has("objectiveThreatAbsent") === true)
    && (!blockerOpportunity || gateBypasses?.has("blockerOpportunityAbsent") === true);
}

/** Re-evaluate the optional Research gates for a diagnostic observer. The selector checks this against its own decision before reporting it. */
function inspectResearchDrawGates(state: GameState, actor: number, branch: BotBranch, choices: ReturnType<typeof deploymentChoices>, routeScores: ReadonlyMap<HexKey, number>, tacticOverrides?: BotTacticOverrides): BotResearchDrawGateDiagnostics {
  const researchDeckAvailable = !state.decks.research.exhausted;
  const deploymentNotStarted = state.deploymentsThisTurn === 0;
  const hand = state.players[actor]?.researchCardIds ?? [];
  const researchHandBelowTwo = hand.length < 2;
  const units = state.units.filter((unit) => unit.ownerPlayer === actor && unit.location !== "record-tile" && unit.location !== "permanently-removed");
  const focus = focusTarget(state, actor, branch);
  const objectiveDistance = focus ? Object.values(boardForState(state).hexes)
    .filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site") && !state.stompedLocations.includes(hex.key))
    .reduce((nearest, hex) => Math.min(nearest, hexDistance(state, focus.location, hex.key)), 99) : 99;
  const objectiveThreat = Boolean(focus && objectiveDistance <= focus.move + 1 && (focus.infamy >= 2 || objectiveDistance <= 1));
  const researchFirstPolicy = botTacticForPlayer(state, actor, tacticOverrides) === "research-first";
  const blockerOpportunity = choices.some((choice) => choice.destinations.some((destination) => (routeScores.get(destination) ?? 0) >= 10));
  return {
    researchDeckAvailable,
    deploymentNotStarted,
    researchHandBelowTwo,
    researchFirstPolicy,
    activeMilitaryScreen: units.length >= 1,
    objectiveThreatAbsent: !objectiveThreat,
    blockerOpportunityAbsent: !blockerOpportunity,
  };
}

function legalResearchDrawAvailable(state: GameState): boolean {
  return state.phase === "deploy"
    && state.pendingDecision?.type === "deployment"
    && (!("playerIndex" in state.pendingDecision) || state.pendingDecision.playerIndex === state.currentPlayer)
    && state.deploymentsThisTurn === 0
    && !state.decks.research.exhausted
    && Boolean(state.players[state.currentPlayer]);
}

export function chooseBotCommand(
  state: GameState,
  botPlayerIndices: ReadonlySet<number> = new Set([1, 2, 3]),
  tacticOverrides?: BotTacticOverrides,
  onDeployDecision?: BotDeployDecisionObserver,
  routeBlockMultiplierOverrides?: BotRouteBlockMultiplierOverrides,
  researchDrawGateBypassOverrides?: BotResearchDrawGateBypassOverrides,
): GameCommand | undefined {
  const decision = state.pendingDecision;
  const actor = decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
  const branch = (state.setupAssignments?.[actor]?.branch ?? BRANCHES[(actor - 1) % BRANCHES.length]) as BotBranch;
  const activeMonster = state.monsters[state.currentPlayer];
  const fenceOwner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
  if (fenceOwner >= 0 && botPlayerIndices.has(fenceOwner)) {
    const target = legalLaserFenceTargets(state).filter((candidate) => candidate.targetMonsterId !== state.monsters[fenceOwner]?.id)
      .sort((a, b) => (b.infamy + (state.pendingBattles.some((battle) => battle.monsterId === b.targetMonsterId) ? 5 : 0)) - (a.infamy + (state.pendingBattles.some((battle) => battle.monsterId === a.targetMonsterId) ? 5 : 0)))[0];
    if (target) {
      const battle = state.pendingBattles.find((candidate) => candidate.monsterId === target.targetMonsterId);
      const retreat = Boolean(target.retreatDestinations.length && (target.infamy < 2 || (battle && battle.militaryUnitIds.length >= 2)));
      const destination = retreat ? [...target.retreatDestinations].sort((a, b) => hexDistance(state, a, state.monsters[fenceOwner]!.location) - hexDistance(state, b, state.monsters[fenceOwner]!.location))[0] : undefined;
      return { type: "use-research", cardId: "Laser Fence", targetMonsterId: target.targetMonsterId, choice: retreat ? "retreat" : "infamy", ...(destination ? { destination } : {}) };
    }
  }
  if (!botPlayerIndices.has(actor) || state.phase === "game-over") return undefined;
  const unresolvedChoice = ["mutation-choice", "stabilizer-ray-choice", "trophy-choice", "challenge-opponent", "challenge-resolution", "challenge-giant", "challenge-giant-resolution", "retreat", "attack-target", "chopper-lift-choice"].includes(decision?.type ?? "");
  if (actor === state.currentPlayer && !unresolvedChoice && state.phase !== "challenge" && activeMonster?.name === "Gargantis" && activeMonster.health <= activeMonster.maxHealth * 0.55) {
    const cards = state.players[actor]?.mutationCardIds ?? [];
    const needed = Math.ceil((activeMonster.maxHealth * 0.7 - activeMonster.health) / 3);
    if (cards.length) return { type: "use-monster-ability", ability: "gargantis-heal", mutationCardIds: cards.slice(0, needed) };
  }

  const hand = state.players[actor]?.researchCardIds ?? [];
  if (actor === state.currentPlayer && canUseDefenseSatellites(state, actor)) {
    const targets = state.monsters.filter((monster, index) => index !== actor && monster.health > 0 && boardForState(state).hexes[monster.location as HexKey]);
    if (targets.length >= 2 || targets.some((monster) => monster.health <= 1)) return { type: "use-research", cardId: "Defense Satellites" };
  }

  if (actor === state.currentPlayer && hand.includes("Cutbacks") && ["move", "fight", "encounter", "deploy"].includes(state.phase)) {
    const threatOrder = ["Defense Satellites", "Antimatter", "Stabilizer Ray", "Guard Commander", "X-Fighters", "Captain Colossal", "Mecha-Monster"];
    const target = state.players.flatMap((player, researchPlayerIndex) => researchPlayerIndex === actor ? [] : (player.visibleResearchCardIds ?? player.researchCardIds).map((researchCardId) => ({ researchCardId, researchPlayerIndex })))
      .sort((a, b) => threatOrder.indexOf(a.researchCardId) - threatOrder.indexOf(b.researchCardId))[0];
    if (target && threatOrder.includes(target.researchCardId)) return { type: "use-research", cardId: "Cutbacks", researchCardId: target.researchCardId, researchPlayerIndex: target.researchPlayerIndex };
  }

  if (actor === state.currentPlayer && hand.includes("Blonde Lure") && ["move", "fight", "encounter", "deploy"].includes(state.phase)) {
    const board = boardForState(state);
    const target = focusTarget(state, actor, branch);
    const edge = target && board.edges.filter((candidate) => candidate.enabled && candidate.from === target.location)
      .sort((a, b) => {
        const nearOurUnits = (key: HexKey) => state.units.filter((unit) => unit.ownerPlayer === actor && hexDistance(state, unit.location, key) <= 1).length;
        return nearOurUnits(b.to) - nearOurUnits(a.to) || featureValue(state, b.to) - featureValue(state, a.to);
      })[0];
    if (target && edge) return { type: "use-research", cardId: "Blonde Lure", targetMonsterId: target.id, destination: edge.to };
  }

  if (actor === state.currentPlayer && hand.includes("Chopper Lift") && ["move", "fight"].includes(state.phase)) {
    const battleDecision = state.pendingDecision?.type === "battle-resolution" ? state.pendingDecision : undefined;
    const battle = battleDecision ? state.pendingBattles.find((candidate) => candidate.id === battleDecision.battleId) : undefined;
    const target = focusTarget(state, actor, branch);
    const shouldLift = (battle && battle.monsterId !== activeMonster?.id && battle.militaryUnitIds.length >= 2)
      || Boolean(target && (target.infamy >= 3 || featureValue(state, target.location as HexKey) >= 4));
    if (shouldLift && decision && (decision.type === "monster-movement" || decision.type === "battle-resolution")) return { type: "use-research", cardId: "Chopper Lift" };
  }

  if (state.pendingChopperLift && state.pendingDecision?.type === "chopper-lift-choice") {
    const choices = state.monsters.filter((monster) => monster.health > 0 && monster.id !== activeMonster?.id).flatMap((monster) => {
      const priority = monster.infamy * 2 + featureValue(state, monster.location as HexKey) * 2 + (monster.health < 10 ? 4 : 0);
      return legalChopperLiftDestinations(state, monster.id, state.pendingChopperLift!.roll).map((destination) => ({ monster, destination, priority }));
    });
    const choice = choices.sort((a, b) => b.priority - a.priority
      || featureValue(state, a.destination) - featureValue(state, b.destination)
      || hexDistance(state, a.destination, state.monsters[actor]!.location) - hexDistance(state, b.destination, state.monsters[actor]!.location))[0];
    if (choice) return { type: "resolve-chopper-lift", targetMonsterId: choice.monster.id, destination: choice.destination };
  }

  if (decision?.type === "mutation-choice") {
    const monster = state.monsters.find((candidate) => candidate.id === decision.monsterId);
    const cardId = monster?.name === "Toxicor" ? selectChallengeMutation(decision.cardIds) : decision.cardIds[0];
    return cardId ? { type: "choose-mutation-card", cardId } : undefined;
  }
  if (decision?.type === "stabilizer-ray-choice") return { type: "choose-stabilizer-ray-mutation", cardId: decision.cardIds[0]! };
  if (decision?.type === "trophy-choice") {
    const candidate = [...decision.unitIds].sort((a, b) => {
      const ua = state.units.find((unit) => unit.id === a);
      const ub = state.units.find((unit) => unit.id === b);
      return (ua?.health ?? 0) - (ub?.health ?? 0) || (ua?.damage ?? 0) - (ub?.damage ?? 0);
    })[0];
    return candidate ? { type: "resolve-encounter", trophyUnitId: candidate } : undefined;
  }
  if (decision?.type === "challenge-opponent") {
    const opponent = decision.opponentIds.map((id) => state.monsters.find((monster) => monster.id === id)!).filter(Boolean).sort((a, b) => a.health - b.health)[0];
    return opponent ? { type: "challenge-opponent", opponentMonsterId: opponent.id } : undefined;
  }
  if (decision?.type === "challenge-giant") return decision.giantUnitIds[0] ? { type: "challenge-giant", giantUnitId: decision.giantUnitIds[0] } : undefined;
  if (decision?.type === "challenge-resolution" || decision?.type === "challenge-giant-resolution") {
    const turn = state.challenge?.turn;
    const attacker = turn && state.monsters.find((monster) => monster.id === turn.attackerId);
    if (attacker?.name === "Toxicor" && state.monsters.indexOf(attacker) === actor) {
      const mutations = state.players[actor]?.mutationCardIds ?? [];
      if (mutations.includes("Son of a Monster") && attacker.health < attacker.maxHealth) return { type: "use-mutation", cardId: "Son of a Monster" };
      if (mutations.includes("Berserk")) return { type: "use-mutation", cardId: "Berserk" };
    }
    if (turn?.remainingAttacks) return { type: "resolve-challenge" };
    return { type: "resolve-challenge", endTurn: true };
  }
  if (decision?.type === "retreat") return retreatCommand(state);
  if (decision?.type === "attack-target") {
    const target = decision.targetIds.map((id) => state.units.find((unit) => unit.id === id)).filter((unit) => unit && unit.location === state.pendingBattles.find((battle) => battle.id === decision.battleId)?.location)
      .sort((a, b) => (a!.defense - a!.damage) - (b!.defense - b!.damage))[0];
    return target ? { type: "resolve-fight", battleId: decision.battleId, targetUnitId: target.id } : undefined;
  }
  if (state.pendingDecision?.type === "battle-resolution") {
    const battleId = state.pendingDecision.battleId;
    const battle = state.pendingBattles.find((candidate) => candidate.id === battleId);
    const hand = state.players[actor]?.researchCardIds ?? [];
    const targetMonster = state.monsters.find((monster) => monster.id === battle?.monsterId);
    const engagedUnits = battle?.militaryUnitIds.filter((id) => state.units.some((unit) => unit.id === id && unit.location === battle.location)).length ?? 0;
    const cannonTargets = hand.includes("Molecular Cannon") ? legalMolecularCannonTargets(state) : [];
    const cannon = cannonTargets.map((candidate) => ({ ...candidate, monster: state.monsters.find((monster) => monster.id === candidate.targetMonsterId)! }))
      .sort((a, b) => ((b.monster.health <= 6 ? 10 : 0) + b.monster.infamy * 2 + featureValue(state, b.monster.location as HexKey)) - ((a.monster.health <= 6 ? 10 : 0) + a.monster.infamy * 2 + featureValue(state, a.monster.location as HexKey)))[0];
    if (cannon && (cannon.monster.health <= 6 || cannon.monster.infamy >= 3)) return { type: "use-research", cardId: "Molecular Cannon", battleId: cannon.battleId, targetMonsterId: cannon.targetMonsterId, destination: cannon.destination };
    if (battle && targetMonster && hand.includes("Antimatter") && (engagedUnits >= 2 || targetMonster.health <= 4)) return { type: "use-research", cardId: "Antimatter", battleId: battle.id };
    if (battle && targetMonster && engagedUnits >= 2 && hand.includes("Stabilizer Ray") && state.players[state.monsters.findIndex((monster) => monster.id === targetMonster.id)]?.mutationCardIds.length) return { type: "use-research", cardId: "Stabilizer Ray", battleId: battle.id };
    if (battle?.monsterId === activeMonster?.id && state.players[actor]?.mutationCardIds.includes("Berserk") && (activeMonster.health <= activeMonster.maxHealth * 0.6 || engagedUnits >= 2)) return { type: "use-mutation", cardId: "Berserk", battleId: battle.id };
    return { type: "resolve-fight", battleId: state.pendingDecision.battleId };
  }
  if (state.phase === "fight") {
    const battle = state.pendingBattles[0];
    return battle ? { type: "resolve-fight", battleId: battle.id } : undefined;
  }
  if (decision?.type === "encounter-choice") return { type: "resolve-encounter", choice: decision.choices.includes("health") && activeMonster?.health < 12 ? "health" : "infamy" };
  if (decision?.type === "encounter-resolution") return { type: "resolve-encounter", choice: "infamy" };
  if (decision?.type === "deployment" || state.phase === "deploy") {
    const giantBases = legalGiantPlacementDestinations(state);
    if (giantBases.length) {
      const heldGiant = state.players[actor]?.researchCardIds.includes("Captain Colossal") ? "Captain Colossal"
        : state.players[actor]?.researchCardIds.includes("Mecha-Monster") ? "Mecha-Monster" : undefined;
      if (heldGiant) {
        const command: GameCommand = { type: "use-research", cardId: heldGiant, destination: giantBases[0]! };
        onDeployDecision?.({
          playerIndex: actor,
          path: "priority-giant-placement",
          deploymentChoiceCount: null,
          legalResearchDrawAvailable: legalResearchDrawAvailable(state),
          selectedCommandType: command.type,
          gates: null,
          eligible: null,
        });
        return command;
      }
    }
    const options = deploymentChoices(state);
    if (!options.length) {
      const command: GameCommand = state.deploymentsThisTurn > 0 || state.decks.research.exhausted ? { type: "pass-deploy" } : { type: "draw-research" };
      onDeployDecision?.({
        playerIndex: actor,
        path: "no-deployment-choices",
        deploymentChoiceCount: 0,
        legalResearchDrawAvailable: legalResearchDrawAvailable(state),
        selectedCommandType: command.type,
        gates: null,
        eligible: null,
      });
      return command;
    }
    const routeScores = routeBlockScores(state, actor, branch, tacticOverrides, routeBlockMultiplierOverrides?.get(actor));
    const gateBypasses = researchDrawGateBypassOverrides?.get(actor);
    const drawResearch = shouldDrawResearch(state, actor, branch, options, routeScores, tacticOverrides, gateBypasses);
    let gates: BotResearchDrawGateDiagnostics | null = null;
    if (onDeployDecision) {
      gates = inspectResearchDrawGates(state, actor, branch, options, routeScores, tacticOverrides);
      const independentlyEvaluated = gates.researchDeckAvailable
        && gates.deploymentNotStarted
        && gates.researchHandBelowTwo
        && gates.researchFirstPolicy
        && gates.activeMilitaryScreen
        && (gates.objectiveThreatAbsent || gateBypasses?.has("objectiveThreatAbsent") === true)
        && (gates.blockerOpportunityAbsent || gateBypasses?.has("blockerOpportunityAbsent") === true);
      if (independentlyEvaluated !== drawResearch) {
        throw new Error("Research-draw diagnostics disagree with the selector's existing eligibility check.");
      }
    }
    if (drawResearch) {
      const command: GameCommand = { type: "draw-research" };
      onDeployDecision?.({
        playerIndex: actor,
        path: "optional-research-choice",
        deploymentChoiceCount: options.length,
        legalResearchDrawAvailable: legalResearchDrawAvailable(state),
        selectedCommandType: command.type,
        gates: gates!,
        eligible: true,
        ...(gateBypasses ? { bypassedGates: [...gateBypasses].filter((gate) => !gates![gate]) } : {}),
      });
      return command;
    }
    const focus = focusTarget(state, actor, branch);
    const deploymentScore = (option: typeof options[number]) => Math.max(...option.destinations.map((destination) => {
      const target = state.monsters.find((monster) => monster.location === destination && monster.id !== state.monsters[actor]?.id);
      const attackersAtTarget = target ? state.units.filter((unit) => unit.ownerPlayer === actor && unit.location === destination).length + 1 : 0;
      const immediateAttack = target && target.health <= 5 && attackersAtTarget >= 3 ? 12 : 0;
      const toxicorAmmoPenalty = option.typeId === "air-force-cruise-missile" && focus?.name === "Toxicor" && focus.health > 5 ? 30 : 0;
      const unitPriority = branch === "Marines" && option.typeId === "marines-rocket-launcher" ? 3 : 0;
      return nearestTargetScore(state, destination, actor, branch, routeScores, option.typeId) + immediateAttack + unitPriority - toxicorAmmoPenalty;
    }));
    const choice = [...options].sort((a, b) => deploymentScore(b) - deploymentScore(a))[0]!;
    const destination = [...choice.destinations].sort((a, b) => nearestTargetScore(state, b, actor, branch, routeScores, choice.typeId) - nearestTargetScore(state, a, actor, branch, routeScores, choice.typeId))[0]!;
    const command: GameCommand = { type: choice.kind, unitId: choice.id, destination };
    onDeployDecision?.({
      playerIndex: actor,
      path: "optional-research-choice",
      deploymentChoiceCount: options.length,
      legalResearchDrawAvailable: legalResearchDrawAvailable(state),
      selectedCommandType: command.type,
      gates: gates!,
      eligible: false,
      ...(gateBypasses ? { bypassedGates: [...gateBypasses].filter((gate) => !gates![gate]) } : {}),
    });
    return command;
  }
  if (decision?.type === "monster-movement") {
    const monster = state.monsters.find((candidate) => candidate.id === decision.pieceId);
    if (monster) {
      const paths = legalMonsterPaths(state, monster.id);
      const choice = bestPath(paths, (destination) => tileScore(state, destination, actor, branch, true));
      if (choice && choice.length > 1) return { type: "move", path: choice, continueMovement: true };
    }

    // The movement decision normally names the active monster, not a unit.
    // Once that monster has moved (or has no legal move), use the rest of the
    // movement window to reposition this player's military pieces.
    const routeScores = routeBlockScores(state, actor, branch, tacticOverrides, routeBlockMultiplierOverrides?.get(actor));
    const focus = focusTarget(state, actor, branch);
    const unmovedUnits = state.units.filter((unit) => unit.ownerPlayer === actor
      && unit.location !== "record-tile" && unit.location !== "permanently-removed"
      && !state.movedPieceIds.includes(unit.id));
    if (branch === "Navy") {
      const submarine = unmovedUnits.find((unit) => unit.unitTypeId === "navy-nuclear-submarine");
      if (submarine) {
        const targets = legalSubmarineTargets(state, submarine.id).filter((target) => {
          if (target.name === "Toxicor" && target.health > 6) return false;
          const support = state.units.filter((candidate) => candidate.ownerPlayer === actor && candidate.id !== submarine.id && hexDistance(state, candidate.location, target.location) <= 1).length;
          return target.health <= 4 || support >= 2;
        }).sort((a, b) => a.health - b.health);
        if (targets[0]) return { type: "launch-submarine-at-monster", unitId: submarine.id, monsterId: targets[0].id };
      }
    }

    const moves = unmovedUnits.flatMap((unit) => {
      const paths = shortestLegalUnitPaths(state, unit.id);
      const currentScore = nearestTargetScore(state, unit.location as HexKey, actor, branch, routeScores, unit.unitTypeId)
        + exposedCityBonus(state, unit.location as HexKey, actor);
      const choice = bestPath(paths, (destination) => {
        const score = nearestTargetScore(state, destination, actor, branch, routeScores, unit.unitTypeId)
          + exposedCityBonus(state, destination, actor);
        return unit.unitTypeId === "air-force-cruise-missile" && focus?.name === "Toxicor" && focus.health > 5 && destination === focus.location
          ? score - 100
          : score;
      });
      if (!choice || choice.length <= 1) return [];
      const destination = choice.at(-1)!;
      const score = nearestTargetScore(state, destination, actor, branch, routeScores, unit.unitTypeId)
        + exposedCityBonus(state, destination, actor) - currentScore;
      return score > 0.5 ? [{ unit, path: choice, score }] : [];
    }).sort((a, b) => b.score - a.score);
    if (moves[0]) return { type: "move-unit", unitId: moves[0].unit.id, path: moves[0].path };
    return { type: "pass-move" };
  }
  if (state.phase === "move") return { type: "pass-move" };
  if (state.phase === "encounter") return { type: "resolve-encounter", choice: "infamy" };
  return undefined;
}

function locationName(state: GameState, key: string): string {
  return boardForState(state).hexes[key as HexKey]?.label ?? getLocation(key)?.name ?? key;
}

function explainBotCommand(state: GameState, command: GameCommand, actor: number): string | undefined {
  const branch = (state.setupAssignments?.[actor]?.branch ?? "Army") as BotBranch;
  const focus = focusTarget(state, actor, branch);
  if (command.type === "move") {
    const monster = state.monsters[state.currentPlayer];
    const destination = command.path.at(-1)!;
    const tile = boardForState(state).hexes[destination as HexKey];
    if (monster?.name === "Toxicor" && monster.health < 20 && tile?.features.some((feature) => feature.kind === "city")) return `Moved Toxicor toward ${locationName(state, destination)} to recover to 20 Health before seeking Mutations.`;
    if (monster?.name === "Toxicor" && monster.health >= 20 && tile?.features.some((feature) => feature.kind === "mutation-site")) return `Moved Toxicor to ${locationName(state, destination)} to collect a Mutation for the Monster Challenge.`;
    if (monster?.name === "Tomanagi" && (tile?.waterClass === "sea" || tile?.waterClass === "seacoast")) return `Moved Tomanagi to ${locationName(state, destination)} to set up its coastal attack bonus.`;
    if (monster?.name === "Zorb" && tile?.features.some((feature) => feature.kind === "city")) return `Moved Zorb toward ${locationName(state, destination)} to gain Infamy from the city.`;
    if (monster?.name === "Megaclaw" && tile?.features.some((feature) => feature.kind === "infamy-site")) return `Moved Megaclaw to ${locationName(state, destination)} to collect its extra Infamy.`;
    if (monster?.name === "Konk" && state.units.some((unit) => unit.location === destination && unit.unitTypeId?.includes("fighter"))) return `Sent Konk after a fighter, where its attack bonus applies.`;
    if (monster?.name === "Gargantis" && monster.health <= monster.maxHealth * 0.55) return `Moved Gargantis cautiously while saving Mutation cards for healing.`;
    if (monster && monster.name !== "Megaclaw" && !(monster.name === "Toxicor" && monster.health >= 20)
      && tile?.features.some((feature) => feature.kind === "city" && feature.benefit.kind === "health-roll" && feature.benefit.dice >= 2)) {
      return `Moved ${monster.name} toward ${locationName(state, destination)} for its high-roll city reward and nearby city cluster.`;
    }
    const feature = tile?.features.find((candidate) => candidate.kind === "city" || candidate.kind === "infamy-site");
    return feature ? `Moved ${monster?.name ?? "the monster"} toward ${locationName(state, destination)} to pressure an objective.` : `Moved ${monster?.name ?? "the monster"} to avoid the nearest military concentration.`;
  }
  if (command.type === "move-unit" || command.type === "deploy" || command.type === "redeploy") {
    const unit = state.units.find((candidate) => candidate.id === command.unitId);
    const destination = command.type === "move-unit" ? command.path.at(-1) : command.destination;
    if (!destination) return undefined;
    const routeScore = routeBlockScores(state, actor, branch).get(destination as HexKey) ?? 0;
    if (routeScore >= 8 && focus) return `Positioned ${unit?.unitTypeId?.replaceAll("-", " ") ?? branch} on a monster route to block ${focus.name} from the next objective.`;
    if (focus) return `Concentrated ${branch} forces toward ${focus.name}${focus.health < 8 ? " to finish the wounded target" : " for a coordinated attack"}.`;
    return `Deployed ${branch} forces to protect objectives and build an attack group.`;
  }
  if (command.type === "draw-research") {
    if (deploymentChoices(state).length === 0) {
      return "Drew Military Research because no legal military deployments were available.";
    }
    return "Drew Military Research as part of the research-first plan while no urgent monster route needed blocking.";
  }
  if (command.type === "choose-mutation-card" && state.monsters[actor]?.name === "Toxicor") return `Toxicor kept ${command.cardId} for its Monster Challenge.`;
  if (command.type === "use-mutation" && state.phase === "challenge") return `Toxicor used ${command.cardId} to strengthen its Monster Challenge turn.`;
  if (command.type === "use-mutation" && command.cardId === "Berserk") return "Used Berserk to add attacks while the monster faced a concentrated force.";
  if (command.type === "use-monster-ability" && command.ability === "gargantis-heal") return "Gargantis spent only the Mutation cards needed to recover before its next fight.";
  if (command.type === "launch-submarine-at-monster") return `Launched the Navy submarine at a supported or vulnerable ${state.monsters.find((monster) => monster.id === command.monsterId)?.name ?? "monster"}.`;
  if (command.type === "use-research") {
    if (command.cardId === "Laser Fence") return command.choice === "retreat" ? "Used Laser Fence to pull the monster out of a concentrated military battle." : "Used Laser Fence to make the monster spend Infamy before its next action.";
    if (command.cardId === "Antimatter") return "Armed Antimatter for a supported attack or a chance to finish the monster.";
    if (command.cardId === "Stabilizer Ray") return "Armed Stabilizer Ray to strip a Mutation from a monster hit by the force.";
    if (command.cardId === "Defense Satellites") return "Used Defense Satellites while several rival monsters were exposed or one was near defeat.";
    if (command.cardId === "Chopper Lift") return "Started Chopper Lift to remove a high Infamy monster from a valuable position or massed battle.";
    if (command.cardId === "Molecular Cannon") return `Used Molecular Cannon to threaten ${state.monsters.find((monster) => monster.id === command.targetMonsterId)?.name ?? "the battle target"} and break contact.`;
    if (command.cardId === "Cutbacks") return `Used Cutbacks to remove an opponent's ${command.researchCardId ?? "valuable Research card"}.`;
    if (command.cardId === "Blonde Lure") return `Lured ${state.monsters.find((monster) => monster.id === command.targetMonsterId)?.name ?? "a monster"} toward a contested space.`;
    if (command.cardId === "Captain Colossal" || command.cardId === "Mecha-Monster") return `Deployed ${command.cardId} to strengthen the branch's attack group.`;
  }
  if (command.type === "resolve-fight") return focus ? `Resolved the fight to weaken ${focus.name} before it reaches another objective.` : "Resolved the active battle before continuing the turn.";
  if (command.type === "resolve-encounter") return command.choice === "health" ? "Chose Health to keep the monster alive for another turn." : "Chose Infamy to strengthen the next attack or victory push.";
  if (command.type === "pass-deploy" || command.type === "pass-move") return "Passed the phase after checking for a useful movement or deployment.";
  return undefined;
}

export interface BotActionStep {
  state: GameState;
  command?: GameCommand;
  explanation: string;
  error?: string;
}

export function botActionDelayMs(command: GameCommand, reducedMotion = false): number {
  if (command.type === "move" || command.type === "move-unit") {
    return reducedMotion ? 650 : Math.max(650, (command.path.length - 1) * 400 + 400);
  }
  if (command.type === "resolve-fight" || command.type === "use-research" && command.cardId === "Molecular Cannon") return 900;
  if (command.type === "resolve-encounter") return 800;
  return 650;
}

/** Apply exactly one bot choice so the UI can render and animate it before the next choice. */
export function runBotActionWithExplanation(initial: GameState): BotActionStep {
  const command = chooseBotCommand(initial);
  if (!command) return { state: initial, explanation: "" };
  const decision = initial.pendingDecision;
  const actor = decision && "playerIndex" in decision ? decision.playerIndex : initial.currentPlayer;
  const explanation = explainBotCommand(initial, command, actor) ?? "";
  try {
    const next = applyCommand(initial, command).state;
    return next === initial
      ? { state: initial, command, explanation, error: "The bot action did not change the game state." }
      : { state: next, command, explanation };
  } catch (error) {
    return { state: initial, command, explanation, error: error instanceof Error ? error.message : "The bot action was rejected." };
  }
}

export function runBotTurnWithExplanation(initial: GameState, maxActions = 80): { state: GameState; explanation: string } {
  let state = initial;
  const explanations: string[] = [];
  for (let step = 0; step < maxActions; step += 1) {
    const result = runBotActionWithExplanation(state);
    if (!result.command || result.state === state) break;
    if (result.explanation && !explanations.includes(result.explanation) && explanations.length < 2) explanations.push(result.explanation);
    state = result.state;
    const nextDecision = state.pendingDecision;
    const nextActor = nextDecision && "playerIndex" in nextDecision ? nextDecision.playerIndex : state.currentPlayer;
    if (nextActor === 0 || state.phase === "game-over") break;
  }
  return { state, explanation: explanations.join(" ") };
}

export function runBotTurn(initial: GameState, maxActions = 80): GameState {
  return runBotTurnWithExplanation(initial, maxActions).state;
}
