import type { GameState } from "@abominations/game-engine";

export interface MatchCounters {
  stompedTiles: number;
  damageTaken: number;
  healthGained: number;
  luckTotal: number;
  luckRolls: number;
}

export const emptyMatchCounters = (playerCount: number): MatchCounters[] => Array.from({ length: playerCount }, () => ({
  stompedTiles: 0,
  damageTaken: 0,
  healthGained: 0,
  luckTotal: 0,
  luckRolls: 0,
}));

/** Update lifetime-ready match counters from the authoritative before/after snapshots. */
export function updateMatchCounters(before: GameState, after: GameState, current: readonly MatchCounters[], actorPlayerIndex: number): MatchCounters[] {
  const next = emptyMatchCounters(after.players.length).map((value, index) => ({ ...value, ...(current[index] ?? {}) }));
  for (let index = 0; index < after.monsters.length; index += 1) {
    const healthBefore = before.monsters[index]?.health;
    const healthAfter = after.monsters[index]?.health;
    if (healthBefore === undefined || healthAfter === undefined) continue;
    if (healthAfter < healthBefore) next[index]!.damageTaken += healthBefore - healthAfter;
    if (healthAfter > healthBefore) next[index]!.healthGained += healthAfter - healthBefore;
  }
  const stompedBefore = new Set(before.stompedLocations ?? []);
  if (next[actorPlayerIndex]) next[actorPlayerIndex]!.stompedTiles += (after.stompedLocations ?? []).filter((location) => !stompedBefore.has(location)).length;
  const rollsBefore = before.dieRollHistory?.length ?? 0;
  const rolls = (after.dieRollHistory ?? []).slice(rollsBefore);
  if (next[actorPlayerIndex]) {
    next[actorPlayerIndex]!.luckRolls += rolls.length;
    next[actorPlayerIndex]!.luckTotal += rolls.reduce((total, roll) => total + roll - 3.5, 0);
  }
  return next;
}

export type MatchStatIdentity = {
  participantId: string;
  userId: string;
  username: string;
  playerIndex: number;
  botAssisted: boolean;
};

export function completedMatchRows(roomId: string, state: GameState, counters: readonly MatchCounters[], identities: readonly MatchStatIdentity[]) {
  return identities.flatMap((identity) => {
    const monster = state.monsters[identity.playerIndex];
    const player = state.players[identity.playerIndex];
    const branch = state.setupAssignments?.[identity.playerIndex]?.branch;
    const metrics = counters[identity.playerIndex];
    if (!monster || !player || !branch || !metrics) return [];
    return [{
      roomId,
      participantId: identity.participantId,
      userId: identity.userId,
      playerIndex: identity.playerIndex,
      username: identity.username,
      outcome: state.winnerPlayer === undefined ? "tie" : state.winnerPlayer === identity.playerIndex ? "win" : "loss",
      monsterId: monster.id,
      monsterName: monster.name,
      branch,
      stompedTiles: metrics.stompedTiles,
      damageTaken: metrics.damageTaken,
      healthGained: metrics.healthGained,
      luckTotal: metrics.luckTotal,
      luckRolls: metrics.luckRolls,
      botAssisted: identity.botAssisted,
      rounds: state.round,
    }];
  });
}

export function sumPlayerStats(rows: readonly Record<string, any>[], username: string) {
  const stats = {
    username,
    gamesPlayed: rows.length,
    wins: rows.filter((row) => row.outcome === "win").length,
    losses: rows.filter((row) => row.outcome === "loss").length,
    ties: rows.filter((row) => row.outcome === "tie").length,
    winRate: 0,
    stompedTiles: 0,
    damageTaken: 0,
    healthGained: 0,
    luckTotal: 0,
    luckRolls: 0,
    luckAverage: null as number | null,
    monsterChoices: {} as Record<string, number>,
    branchChoices: {} as Record<string, number>,
    mostChosenMonster: undefined as string | undefined,
    mostChosenBranch: undefined as string | undefined,
  };
  for (const row of rows) {
    stats.stompedTiles += row.stompedTiles;
    stats.damageTaken += row.damageTaken;
    stats.healthGained += row.healthGained;
    stats.luckTotal += row.luckTotal;
    stats.luckRolls += row.luckRolls;
    stats.monsterChoices[row.monsterName] = (stats.monsterChoices[row.monsterName] ?? 0) + 1;
    stats.branchChoices[row.branch] = (stats.branchChoices[row.branch] ?? 0) + 1;
  }
  stats.winRate = stats.gamesPlayed ? stats.wins / stats.gamesPlayed : 0;
  stats.luckAverage = stats.luckRolls ? stats.luckTotal / stats.luckRolls : null;
  stats.mostChosenMonster = mostChosen(stats.monsterChoices);
  stats.mostChosenBranch = mostChosen(stats.branchChoices);
  return stats;
}

function mostChosen(values: Record<string, number>): string | undefined {
  return Object.entries(values).sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName))[0]?.[0];
}
