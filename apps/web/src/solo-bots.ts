import {
  applyCommand,
  boardForState,
  canUseDefenseSatellites,
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
  movementPathAllowed,
  legalSubmarineTargets,
  monsters,
  shortestLegalUnitPaths,
  setupDeploymentState,
  type GameCommand,
  type GameState,
  type HexKey,
  type SetupState,
} from "@abominations/game-engine";
import { deploymentChoices } from "./components/MilitarySheet";

export const BRANCHES = ["Army", "Navy", "Air Force", "Marines"] as const;
export type BotBranch = typeof BRANCHES[number];
export type BotTactic = "force-first" | "research-first";

/** Pick a match-stable, evenly mixed style from the match seed and bot seat. */
export function botTacticForPlayer(state: GameState, playerIndex: number): BotTactic {
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
  Army: "Block the next city or lair with tanks; stack missile launchers behind the screen.",
  Navy: "Use fighters to close distance and hold submarines in launch range; concentrate only when the target is vulnerable.",
  "Air Force": "Mass fighters, save cruise missiles for a high value strike, and draw Research when a counter can swing the matchup.",
  Marines: "Bring rocket launchers together for a decisive volley; use fighters to reach the engagement.",
};

const counterPicks: Record<string, readonly string[]> = {
  Konk: ["Gargantis", "Megaclaw", "Zorb", "Toxicor", "Tomanagi"],
  Zorb: ["Gargantis", "Tomanagi", "Konk", "Megaclaw", "Toxicor"],
  Megaclaw: ["Gargantis", "Toxicor", "Konk", "Tomanagi", "Zorb"],
  Gargantis: ["Toxicor", "Megaclaw", "Zorb", "Konk", "Tomanagi"],
  Toxicor: ["Gargantis", "Megaclaw", "Konk", "Tomanagi", "Zorb"],
  Tomanagi: ["Konk", "Gargantis", "Toxicor", "Megaclaw", "Zorb"],
};

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
  const a = board.hexes[left as HexKey]?.coord;
  const b = board.hexes[right as HexKey]?.coord;
  if (!a || !b) return 99;
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function featureValue(state: GameState, location: HexKey): number {
  const features = boardForState(state).hexes[location]?.features ?? [];
  return features.reduce((value, feature) => value + (feature.kind === "city" ? 4 : feature.kind === "infamy-site" ? 5 : feature.kind === "military-base" ? 2 : 0), 0);
}

function preferredBranch(enemyName: string, available: readonly string[]): BotBranch {
  const preference = branchCounters[enemyName] ?? ["Marines", "Army", "Air Force", "Navy"];
  return (preference.find((branch) => available.includes(branch)) ?? available[0] ?? "Army") as BotBranch;
}

/** Complete one setup choice using the same setup transitions and deployment legality as a human. */
export function chooseBotSetupAction(game: GameState, setup: SetupState, playerIndex: number): SetupState {
  if (setup.phase === "monster-selection") {
    const opponentName = monsterName(setup.seats[0]?.monsterId);
    const preferences = counterPicks[opponentName ?? ""] ?? ["Gargantis", "Toxicor", "Megaclaw", "Konk", "Tomanagi", "Zorb"];
    const available = setup.definition.monsterIds.filter((id) => !setup.seats.some((seat) => seat.monsterId === id));
    const picked = preferences.map((name) => available.find((id) => monsterName(id) === name)).find(Boolean) ?? available[0];
    return picked ? chooseMonster(setup, playerIndex, picked) : setup;
  }
  if (setup.phase === "branch-selection") {
    const enemyName = monsterName(setup.seats[0]?.monsterId) ?? "";
    const available = setup.definition.eligibleBranches.filter((branch) => !setup.seats.some((seat) => seat.branch === branch));
    return chooseBranch(setup, playerIndex, preferredBranch(enemyName, available));
  }
  if (setup.phase === "lair-selection") {
    const seat = setup.seats.find((candidate) => candidate.playerIndex === playerIndex);
    const options = setup.definition.lairsByMonster[seat?.monsterId ?? ""]?.filter((lair) => !setup.seats.some((candidate) => candidate.lair === lair)) ?? [];
    const humanLair = setup.seats[0]?.lair;
    const picked = [...options].sort((a, b) => humanLair ? hexDistance(game, b, humanLair) - hexDistance(game, a, humanLair) : a.localeCompare(b))[0];
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
  if (objectiveAvailable && features.some((feature) => feature.kind === "city")) {
    score += monsterTurn ? monster?.name === "Zorb" && monster.infamy < 3 ? 15 : 8 : 1;
  }
  if (objectiveAvailable && features.some((feature) => feature.kind === "infamy-site")) {
    score += monsterTurn ? monster?.name === "Megaclaw" && monster.infamy < 4 ? 14 : 7 : 0;
  }
  if (features.some((feature) => feature.kind === "military-base")) score += monsterTurn ? 2 : 4;
  if (features.some((feature) => feature.kind === "lair")) score += monsterTurn ? 0 : 2;
  if (location?.name === "Hollywood") score += monsterTurn ? 3 : 1;

  const enemies = state.monsters.filter((candidate, index) => index !== playerIndex && candidate.health > 0 && candidate.location === destination);
  const friendlyUnits = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location === destination);
  const hostileUnits = state.units.filter((unit) => unit.ownerPlayer !== undefined && unit.ownerPlayer !== playerIndex && unit.location === destination);
  if (monsterTurn) {
    const nextObjectiveDistance = Object.values(board.hexes)
      .filter((candidate) => !state.stompedLocations.includes(candidate.key) && candidate.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site"))
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

function nearestTargetScore(state: GameState, destination: HexKey, playerIndex: number, branch: BotBranch, routeScores?: ReadonlyMap<HexKey, number>): number {
  const board = boardForState(state);
  const location = board.hexes[destination];
  const threats = state.monsters.filter((monster, index) => index !== playerIndex && monster.health > 0 && typeof monster.location === "string");
  if (!location || !threats.length) return tileScore(state, destination, playerIndex, branch, false);
  const focus = focusTarget(state, playerIndex, branch);
  if (!focus) return tileScore(state, destination, playerIndex, branch, false);
  const distance = hexDistance(state, destination, focus.location);
  const pressure = (branch === "Army" || branch === "Marines" ? 3.2 : 2.6) * Math.max(0, 9 - distance);
  const blocker = distance <= 2 && focus.infamy >= 2 ? 6 : 0;
  const focusWounded = focus.health < 8 ? 5 : 0;
  const nearbyForce = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location !== "record-tile" && unit.location !== "permanently-removed" && hexDistance(state, unit.location, focus.location) <= 2).length;
  const massing = Math.max(0, 3 - nearbyForce) * (distance <= 2 ? 3 : 1.2);
  const routeBlocking = (routeScores ?? routeBlockScores(state, playerIndex)).get(destination) ?? 0;
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

/** Military positions on a monster's legal route to an unclaimed city or Infamy site gain blocking value. */
export function routeBlockScores(state: GameState, actor = state.currentPlayer): Map<HexKey, number> {
  const scores = new Map<HexKey, number>();
  const board = boardForState(state);
  const forceFirst = botTacticForPlayer(state, actor) === "force-first";
  const goals = Object.values(board.hexes).filter((hex) => !state.stompedLocations.includes(hex.key)
    && hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site"));
  for (const monster of state.monsters) {
    const start = monster.location as HexKey;
    if (monster.health <= 0 || !board.hexes[start]) continue;
    const movement = monster.movement;
    for (const goal of goals) {
      if (goal.key === start) continue;
      // Follow the monster's actual legal edges beyond this turn's move range so
      // military pieces can occupy a corridor before the monster reaches it.
      const queue: HexKey[][] = [[start]];
      const distance = new Map<HexKey, number>([[start, 0]]);
      let shortest = Infinity;
      while (queue.length) {
        const path = queue.shift()!;
        const current = path.at(-1)!;
        const steps = path.length - 1;
        if (current === goal.key) {
          shortest = steps;
          const value = featureValue(state, goal.key);
          path.slice(1, -1).forEach((key, index) => {
            const toGoal = steps - index - 1;
            const pressure = forceFirst
              ? value * 2 + 4 + Math.max(0, 5 - toGoal) * 3
              : value * 1.5 + 2 + Math.max(0, 4 - toGoal) * 2;
            scores.set(key, Math.max(scores.get(key) ?? 0, pressure));
          });
          continue;
        }
        if (steps >= shortest || steps >= 10) continue;
        for (const edge of board.edges) {
          if (!edge.enabled || edge.from !== current || distance.has(edge.to)) continue;
          const nextPath = [...path, edge.to];
          if (!movementPathAllowed(board, nextPath, movement)) continue;
          distance.set(edge.to, steps + 1);
          queue.push(nextPath);
        }
      }
    }
  }
  return scores;
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

function shouldDrawResearch(state: GameState, actor: number, branch: BotBranch, choices: ReturnType<typeof deploymentChoices>, routeScores: ReadonlyMap<HexKey, number>): boolean {
  if (state.decks.research.exhausted || state.deploymentsThisTurn > 0) return false;
  const hand = state.players[actor]?.researchCardIds ?? [];
  if (hand.length >= 2) return false;
  const units = state.units.filter((unit) => unit.ownerPlayer === actor && unit.location !== "record-tile" && unit.location !== "permanently-removed");
  const focus = focusTarget(state, actor, branch);
  const objectiveDistance = focus ? Object.values(boardForState(state).hexes)
    .filter((hex) => hex.features.some((feature) => feature.kind === "city" || feature.kind === "infamy-site") && !state.stompedLocations.includes(hex.key))
    .reduce((nearest, hex) => Math.min(nearest, hexDistance(state, focus.location, hex.key)), 99) : 99;
  const objectiveThreat = Boolean(focus && objectiveDistance <= focus.move + 1 && (focus.infamy >= 2 || objectiveDistance <= 1));
  const researchFirst = botTacticForPlayer(state, actor) === "research-first";
  if (!researchFirst) return false;
  const blockerOpportunity = choices.some((choice) => choice.destinations.some((destination) => (routeScores.get(destination) ?? 0) >= 10));
  // Research-first bots draw once they have a screen in play; force-first bots
  // keep using every legal deployment before drawing any optional Research.
  return units.length >= 1 && !objectiveThreat && !blockerOpportunity;
}

export function chooseBotCommand(state: GameState): GameCommand | undefined {
  const decision = state.pendingDecision;
  const actor = decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
  const branch = (state.setupAssignments?.[actor]?.branch ?? BRANCHES[(actor - 1) % BRANCHES.length]) as BotBranch;
  const activeMonster = state.monsters[state.currentPlayer];
  const fenceOwner = state.players.findIndex((player) => player.researchCardIds.includes("Laser Fence"));
  if (fenceOwner > 0) {
    const target = legalLaserFenceTargets(state).filter((candidate) => candidate.targetMonsterId !== state.monsters[fenceOwner]?.id)
      .sort((a, b) => (b.infamy + (state.pendingBattles.some((battle) => battle.monsterId === b.targetMonsterId) ? 5 : 0)) - (a.infamy + (state.pendingBattles.some((battle) => battle.monsterId === a.targetMonsterId) ? 5 : 0)))[0];
    if (target) {
      const battle = state.pendingBattles.find((candidate) => candidate.monsterId === target.targetMonsterId);
      const retreat = Boolean(target.retreatDestinations.length && (target.infamy < 2 || (battle && battle.militaryUnitIds.length >= 2)));
      const destination = retreat ? [...target.retreatDestinations].sort((a, b) => hexDistance(state, a, state.monsters[fenceOwner]!.location) - hexDistance(state, b, state.monsters[fenceOwner]!.location))[0] : undefined;
      return { type: "use-research", cardId: "Laser Fence", targetMonsterId: target.targetMonsterId, choice: retreat ? "retreat" : "infamy", ...(destination ? { destination } : {}) };
    }
  }
  if (actor === 0 || state.phase === "game-over") return undefined;
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

  if (decision?.type === "mutation-choice") return { type: "choose-mutation-card", cardId: decision.cardIds[0]! };
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
      if (heldGiant) return { type: "use-research", cardId: heldGiant, destination: giantBases[0]! };
    }
    const options = deploymentChoices(state);
    if (!options.length) return state.deploymentsThisTurn > 0 || state.decks.research.exhausted ? { type: "pass-deploy" } : { type: "draw-research" };
    const routeScores = routeBlockScores(state, actor);
    if (shouldDrawResearch(state, actor, branch, options, routeScores)) return { type: "draw-research" };
    const focus = focusTarget(state, actor, branch);
    const deploymentScore = (option: typeof options[number]) => Math.max(...option.destinations.map((destination) => {
      const target = state.monsters.find((monster) => monster.location === destination && monster.id !== state.monsters[actor]?.id);
      const attackersAtTarget = target ? state.units.filter((unit) => unit.ownerPlayer === actor && unit.location === destination).length + 1 : 0;
      const immediateAttack = target && target.health <= 5 && attackersAtTarget >= 3 ? 12 : 0;
      const toxicorAmmoPenalty = option.typeId === "air-force-cruise-missile" && focus?.name === "Toxicor" && focus.health > 5 ? 30 : 0;
      const unitPriority = branch === "Marines" && option.typeId === "marines-rocket-launcher" ? 3 : 0;
      return nearestTargetScore(state, destination, actor, branch, routeScores) + immediateAttack + unitPriority - toxicorAmmoPenalty;
    }));
    const choice = [...options].sort((a, b) => deploymentScore(b) - deploymentScore(a))[0]!;
    const destination = [...choice.destinations].sort((a, b) => nearestTargetScore(state, b, actor, branch, routeScores) - nearestTargetScore(state, a, actor, branch, routeScores))[0]!;
    return { type: choice.kind, unitId: choice.id, destination };
  }
  if (decision?.type === "monster-movement") {
    const monster = state.monsters.find((candidate) => candidate.id === decision.pieceId);
    if (monster) {
      const paths = legalMonsterPaths(state, monster.id);
      const choice = bestPath(paths, (destination) => tileScore(state, destination, actor, branch, true));
      if (choice && choice.length > 1) return { type: "move", path: choice, continueMovement: true };
      return { type: "pass-move" };
    }
    const unit = state.units.find((candidate) => candidate.id === decision.pieceId);
    if (unit) {
      if (branch === "Navy" && unit.unitTypeId === "navy-nuclear-submarine") {
        const targets = legalSubmarineTargets(state, unit.id).filter((monster) => {
          if (monster.name === "Toxicor" && monster.health > 6) return false;
          const support = state.units.filter((candidate) => candidate.ownerPlayer === actor && candidate.id !== unit.id && hexDistance(state, candidate.location, monster.location) <= 1).length;
          return monster.health <= 4 || support >= 2;
        })
          .sort((a, b) => a.health - b.health);
        if (targets[0]) return { type: "launch-submarine-at-monster", unitId: unit.id, monsterId: targets[0].id };
      }
      const paths = shortestLegalUnitPaths(state, unit.id);
      const routeScores = routeBlockScores(state, actor);
      const choice = bestPath(paths, (destination) => {
        const score = nearestTargetScore(state, destination, actor, branch, routeScores);
        const focus = focusTarget(state, actor, branch);
        return unit.unitTypeId === "air-force-cruise-missile" && focus?.name === "Toxicor" && focus.health > 5 && destination === focus.location ? score - 100 : score;
      });
      if (choice && choice.length > 1) return { type: "move-unit", unitId: unit.id, path: choice };
      return paths.length ? { type: "stay-piece", pieceId: unit.id } : { type: "pass-move" };
    }
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
    if (monster?.name === "Tomanagi" && (tile?.waterClass === "sea" || tile?.waterClass === "seacoast")) return `Moved Tomanagi to ${locationName(state, destination)} to set up its coastal attack bonus.`;
    if (monster?.name === "Zorb" && tile?.features.some((feature) => feature.kind === "city")) return `Moved Zorb toward ${locationName(state, destination)} to gain Infamy from the city.`;
    if (monster?.name === "Megaclaw" && tile?.features.some((feature) => feature.kind === "infamy-site")) return `Moved Megaclaw to ${locationName(state, destination)} to collect its extra Infamy.`;
    if (monster?.name === "Konk" && state.units.some((unit) => unit.location === destination && unit.unitTypeId?.includes("fighter"))) return `Sent Konk after a fighter, where its attack bonus applies.`;
    if (monster?.name === "Gargantis" && monster.health <= monster.maxHealth * 0.55) return `Moved Gargantis cautiously while saving Mutation cards for healing.`;
    const feature = tile?.features.find((candidate) => candidate.kind === "city" || candidate.kind === "infamy-site");
    return feature ? `Moved ${monster?.name ?? "the monster"} toward ${locationName(state, destination)} to pressure an objective.` : `Moved ${monster?.name ?? "the monster"} to avoid the nearest military concentration.`;
  }
  if (command.type === "move-unit" || command.type === "deploy" || command.type === "redeploy") {
    const unit = state.units.find((candidate) => candidate.id === command.unitId);
    const destination = command.type === "move-unit" ? command.path.at(-1) : command.destination;
    if (!destination) return undefined;
    const routeScore = routeBlockScores(state, actor).get(destination as HexKey) ?? 0;
    if (routeScore >= 8 && focus) return `Positioned ${unit?.unitTypeId?.replaceAll("-", " ") ?? branch} on a monster route to block ${focus.name} from the next objective.`;
    if (focus) return `Concentrated ${branch} forces toward ${focus.name}${focus.health < 8 ? " to finish the wounded target" : " for a coordinated attack"}.`;
    return `Deployed ${branch} forces to protect objectives and build an attack group.`;
  }
  if (command.type === "draw-research") return "Drew Military Research because the attack group was assembled and no valuable monster route needed an urgent block.";
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
