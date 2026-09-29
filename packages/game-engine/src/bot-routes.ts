import type { HexKey } from "./board.js";

export interface BotShortestRouteDag {
  readonly distances: ReadonlyMap<HexKey, number>;
  readonly predecessors: ReadonlyMap<HexKey, readonly HexKey[]>;
}

const compareHexKeys = (left: HexKey, right: HexKey): number => left < right ? -1 : left > right ? 1 : 0;

/** Build the bounded shortest-path predecessor DAG without choosing one path at forks. */
export function buildBotShortestRouteDag(
  start: HexKey,
  neighbours: (from: HexKey) => readonly HexKey[],
  maxSteps = 10,
): BotShortestRouteDag {
  const distances = new Map<HexKey, number>([[start, 0]]);
  const predecessors = new Map<HexKey, HexKey[]>();
  const queue: HexKey[] = [start];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    const steps = distances.get(current)!;
    if (steps >= maxSteps) continue;

    for (const next of neighbours(current)) {
      const nextDistance = steps + 1;
      const knownDistance = distances.get(next);
      if (knownDistance === undefined) {
        distances.set(next, nextDistance);
        predecessors.set(next, [current]);
        queue.push(next);
      } else if (knownDistance === nextDistance) {
        const parents = predecessors.get(next) ?? [];
        if (!parents.includes(current)) parents.push(current);
        predecessors.set(next, parents);
      }
    }
  }

  for (const parents of predecessors.values()) parents.sort(compareHexKeys);
  return { distances, predecessors };
}

/** Return every hex on any shortest route to a goal in stable reverse-BFS order. */
export function botShortestRouteNodesToGoal(dag: BotShortestRouteDag, goal: HexKey): HexKey[] {
  if (!dag.distances.has(goal)) return [];

  // Predecessors were sorted once when the DAG was built, so this reverse
  // breadth walk is stable across neighbour enumeration order. Marking nodes
  // when enqueued also avoids duplicate queue entries at path merges.
  const seen = new Set<HexKey>([goal]);
  const queue = [goal];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const previous of dag.predecessors.get(current) ?? []) {
      if (seen.has(previous)) continue;
      seen.add(previous);
      queue.push(previous);
    }
  }
  return queue;
}
