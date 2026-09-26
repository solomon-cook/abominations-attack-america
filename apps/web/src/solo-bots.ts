import {
  applyCommand,
  boardForState,
  getLocation,
  legalChopperLiftDestinations,
  legalMonsterPaths,
  legalSubmarineTargets,
  shortestLegalUnitPaths,
  type GameCommand,
  type GameState,
  type HexKey,
} from "@abominations/game-engine";
import { deploymentChoices } from "./components/MilitarySheet";

export const BRANCHES = ["Army", "Navy", "Air Force", "Marines"] as const;
export type BotBranch = typeof BRANCHES[number];

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

export function botStrategyHint(monsterName: string, branch: string): string {
  const monster = monsterPlans[monsterName] ?? "Pressure objectives while avoiding a fight on the opponent’s terms.";
  const military = branchPlans[branch as BotBranch] ?? branchPlans.Army;
  return `${monster} ${military}`;
}

function tileScore(state: GameState, destination: HexKey, playerIndex: number, branch: BotBranch, monsterTurn: boolean): number {
  const board = boardForState(state);
  const hex = board.hexes[destination];
  const location = getLocation(destination);
  const features = hex?.features ?? [];
  let score = 0;
  if (features.some((feature) => feature.kind === "city")) score += monsterTurn ? 8 : 1;
  if (features.some((feature) => feature.kind === "infamy-site")) score += monsterTurn ? 7 : 0;
  if (features.some((feature) => feature.kind === "military-base")) score += monsterTurn ? 2 : 4;
  if (features.some((feature) => feature.kind === "lair")) score += monsterTurn ? 0 : 2;
  if (location?.name === "Hollywood") score += monsterTurn ? 3 : 1;

  const enemies = state.monsters.filter((monster, index) => index !== playerIndex && monster.health > 0 && monster.location === destination);
  const friendlyUnits = state.units.filter((unit) => unit.ownerPlayer === playerIndex && unit.location === destination);
  const hostileUnits = state.units.filter((unit) => unit.ownerPlayer !== undefined && unit.ownerPlayer !== playerIndex && unit.location === destination);
  if (monsterTurn) {
    const monster = state.monsters[playerIndex];
    const danger = hostileUnits.reduce((sum, unit) => sum + unit.damage + (unit.unitTypeId?.includes("missile") ? 2 : 0), 0);
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

function nearestTargetScore(state: GameState, destination: HexKey, playerIndex: number, branch: BotBranch): number {
  const board = boardForState(state);
  const location = board.hexes[destination];
  const threats = state.monsters.filter((monster, index) => index !== playerIndex && monster.health > 0 && typeof monster.location === "string");
  if (!location || !threats.length) return tileScore(state, destination, playerIndex, branch, false);
  const target = threats.map((monster) => {
    const targetHex = board.hexes[monster.location as HexKey];
    const distance = targetHex ? Math.abs(location.coord.q - targetHex.coord.q) + Math.abs(location.coord.r - targetHex.coord.r) : 99;
    return { monster, distance };
  }).sort((a, b) => a.distance - b.distance)[0]!;
  const pressure = (branch === "Army" || branch === "Marines" ? 2.5 : 1.8) * Math.max(0, 8 - target.distance);
  const blocker = target.distance <= 2 && target.monster.infamy >= 2 ? 5 : 0;
  const focusWounded = target.monster.health < 8 ? 4 : 0;
  return pressure + blocker + focusWounded + tileScore(state, destination, playerIndex, branch, false);
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

export function chooseBotCommand(state: GameState): GameCommand | undefined {
  const decision = state.pendingDecision;
  const actor = decision && "playerIndex" in decision ? decision.playerIndex : state.currentPlayer;
  if (actor === 0 || state.phase === "game-over") return undefined;
  const branch = (state.setupAssignments?.[actor]?.branch ?? BRANCHES[(actor - 1) % BRANCHES.length]) as BotBranch;
  const activeMonster = state.monsters[state.currentPlayer];
  if (actor === state.currentPlayer && activeMonster?.name === "Gargantis" && activeMonster.health <= activeMonster.maxHealth - 3) {
    const cards = state.players[actor]?.mutationCardIds ?? [];
    const needed = Math.ceil((activeMonster.maxHealth - activeMonster.health) / 3);
    if (cards.length) return { type: "use-monster-ability", ability: "gargantis-heal", mutationCardIds: cards.slice(0, needed) };
  }

  if (state.pendingChopperLift && state.pendingDecision?.type === "chopper-lift-choice") {
    const target = [...state.monsters].filter((monster) => monster.health > 0 && monster.id !== activeMonster?.id)
      .sort((a, b) => (b.infamy + (b.health < 10 ? 4 : 0)) - (a.infamy + (a.health < 10 ? 4 : 0)))[0];
    const destinations = target ? legalChopperLiftDestinations(state, target.id, state.pendingChopperLift.roll) : [];
    if (target && destinations.length) return { type: "resolve-chopper-lift", targetMonsterId: target.id, destination: destinations[0]! };
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
    if (battle?.militaryUnitIds.length && hand.includes("Antimatter")) return { type: "use-research", cardId: "Antimatter", battleId: battle.id };
    if (battle?.militaryUnitIds.length && hand.includes("Stabilizer Ray") && state.players[state.currentPlayer]?.mutationCardIds.length) return { type: "use-research", cardId: "Stabilizer Ray", battleId: battle.id };
    if (battle?.monsterId === activeMonster?.id && state.players[actor]?.mutationCardIds.includes("Berserk")) return { type: "use-mutation", cardId: "Berserk", battleId: battle.id };
    return { type: "resolve-fight", battleId: state.pendingDecision.battleId };
  }
  if (state.phase === "fight") {
    const battle = state.pendingBattles[0];
    return battle ? { type: "resolve-fight", battleId: battle.id } : undefined;
  }
  if (decision?.type === "encounter-choice") return { type: "resolve-encounter", choice: decision.choices.includes("health") && activeMonster?.health < 12 ? "health" : "infamy" };
  if (decision?.type === "encounter-resolution") return { type: "resolve-encounter", choice: "infamy" };
  if (decision?.type === "deployment" || state.phase === "deploy") {
    const options = deploymentChoices(state);
    if (!options.length) return state.decks.research.exhausted ? { type: "pass-deploy" } : { type: "draw-research" };
    const occupiedTarget = state.monsters.some((monster, index) => index !== actor && monster.health > 0 && options.some((option) => option.destinations.includes(monster.location as HexKey)));
    const researchTactic = !state.decks.research.exhausted && state.deploymentsThisTurn === 0 && (
      (branch === "Air Force" && state.monsters.some((monster, index) => index !== actor && (monster.name === "Megaclaw" || monster.name === "Tomanagi"))) ||
      (branch === "Navy" && state.monsters.some((monster, index) => index !== actor && monster.name === "Toxicor")) ||
      options.length < 2 && state.players[actor]!.researchCardIds.length === 0
    );
    if (researchTactic && !occupiedTarget) return { type: "draw-research" };
    const deploymentScore = (option: typeof options[number]) => nearestTargetScore(state, option.destinations[0]!, actor, branch)
      - (branch === "Air Force" && option.typeId === "air-force-cruise-missile" && state.monsters.some((monster, index) => index !== actor && monster.name === "Toxicor") ? 8 : 0);
    const choice = [...options].sort((a, b) => deploymentScore(b) - deploymentScore(a))[0]!;
    const destination = [...choice.destinations].sort((a, b) => nearestTargetScore(state, b, actor, branch) - nearestTargetScore(state, a, actor, branch))[0]!;
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
        const targets = legalSubmarineTargets(state, unit.id).filter((monster) => monster.name !== "Toxicor" || monster.health <= 6)
          .sort((a, b) => a.health - b.health);
        if (targets[0]) return { type: "launch-submarine-at-monster", unitId: unit.id, monsterId: targets[0].id };
      }
      const paths = shortestLegalUnitPaths(state, unit.id);
      const choice = bestPath(paths, (destination) => nearestTargetScore(state, destination, actor, branch));
      if (choice && choice.length > 1) return { type: "move-unit", unitId: unit.id, path: choice };
      return paths.length ? { type: "stay-piece", pieceId: unit.id } : { type: "pass-move" };
    }
  }
  if (state.phase === "move") return { type: "pass-move" };
  if (state.phase === "encounter") return { type: "resolve-encounter", choice: "infamy" };
  return undefined;
}

export function runBotTurn(initial: GameState, maxActions = 80): GameState {
  let state = initial;
  for (let step = 0; step < maxActions; step += 1) {
    const command = chooseBotCommand(state);
    if (!command) break;
    try {
      const next = applyCommand(state, command).state;
      if (next === state) break;
      state = next;
      const nextDecision = state.pendingDecision;
      const nextActor = nextDecision && "playerIndex" in nextDecision ? nextDecision.playerIndex : state.currentPlayer;
      if (nextActor === 0 || state.phase === "game-over") break;
    } catch {
      break;
    }
  }
  return state;
}
