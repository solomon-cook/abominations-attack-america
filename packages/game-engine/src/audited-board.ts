import { boardContentHash, hexKey, type BoardDefinition, type BoardEdge, type BoardFeature, type BoardHex, type HexCoord, type HexKey, type WaterClass } from "./board.js";
import { AUDITED_CELLS } from "./audited-board-data.js";
export { AUDITED_CELLS, AUDIT_SOURCE_SHA256 } from "./audited-board-data.js";

export const AUDITED_BOARD_ROWS = 14;
export const AUDITED_BOARD_COLUMNS = 24;
export type AuditedCell = (typeof AUDITED_CELLS)[number];

/** Flat-top, odd columns shifted down; shared by rules, rendering and cell artwork. */
export function auditedCoordinate(row: number, column: number): HexCoord {
  return { q: column, r: row - Math.floor(column / 2) };
}
export function auditedRowColumn(coord: HexCoord): { row: number; column: number } {
  return { row: coord.r + Math.floor(coord.q / 2), column: coord.q };
}
export function auditedCellKey(row: number, column: number): HexKey {
  return hexKey(auditedCoordinate(row, column));
}
export const AUDITED_EDGE_DIRECTIONS = [
  { name: "north", q: 0, r: -1, opposite: "south" },
  { name: "northeast", q: 1, r: -1, opposite: "southwest" },
  { name: "southeast", q: 1, r: 0, opposite: "northwest" },
  { name: "south", q: 0, r: 1, opposite: "north" },
  { name: "southwest", q: -1, r: 1, opposite: "northeast" },
  { name: "northwest", q: -1, r: 0, opposite: "southeast" },
] as const;

const waterClasses: Record<AuditedCell["tile"], WaterClass> = {
  Land: "land", Sea: "sea", Coast: "seacoast", "Lake edge": "lakeshore",
};
function featuresForCell(cell: AuditedCell): BoardFeature[] {
  const features: BoardFeature[] = [];
  const city = cell.features.match(/City: ([^;]+);\s*(\d)\s*(HP|D)/);
  if (city) {
    features.push({ kind: "city", benefit: city[3] === "HP"
      ? { kind: "health", amount: Number(city[2]) as 1 | 2 }
      : { kind: "health-roll", dice: Number(city[2]) as 1 | 2 | 3 } });
    if (city[1] === "Los Angeles") features.push({ kind: "los-angeles" });
  }
  for (const branch of ["Army", "Navy", "Air Force", "Marines"] as const) {
    if (cell.features.includes(`${branch} base`)) features.push({ kind: "military-base", branch });
  }
  if (cell.features.includes("Infamy site")) features.push({ kind: "infamy-site" });
  // The human audit records site existence without names; stable IDs make no geographic inference.
  if (cell.features.includes("Mutation site")) features.push({ kind: "mutation-site", siteId: `mutation-${cell.row}-${cell.column}` });
  if (cell.features.includes("Monster Challenge site")) features.push({ kind: "challenge-site" });
  if (cell.features.includes("potential spawn location")) {
    // User confirmed all spawn symbols as lairs, and the 10/2 spelling as Gargantis.
    const monsterId = cell.row === 10 && cell.column === 2 ? "gargantis" : cell.features.split(";")[0].toLowerCase();
    features.push({ kind: "lair", monsterId });
  }
  return features;
}
const cellsByKey = new Map<HexKey, AuditedCell>(AUDITED_CELLS.map((cell) => [auditedCellKey(cell.row, cell.column), cell]));
const hexes = Object.fromEntries(AUDITED_CELLS.map((cell) => {
  const key = auditedCellKey(cell.row, cell.column);
  const label = cell.features.match(/City: ([^;]+)/)?.[1];
  const hex: BoardHex = {
    key, coord: auditedCoordinate(cell.row, cell.column), audit: { row: cell.row, column: cell.column },
    ...(label ? { label } : {}), waterClass: waterClasses[cell.tile], features: featuresForCell(cell),
    sourceRefs: [cell.sourceRef], verification: "verified",
    notes: `Human audit ${cell.row}/${cell.column}. ${cell.tile}. Coastline: ${cell.coastline}. Orientation: ${cell.orientation}. Printed barriers: ${cell.barriers}. Crop: ${cell.crop}. Features: ${cell.features}.`,
  };
  return [key, hex];
})) as Record<HexKey, BoardHex>;
function recordedEdges(cell: AuditedCell): Set<string> {
  return new Set(cell.barriers.toLowerCase().match(/\b(northwest|northeast|southeast|southwest|north|south)\b/g) ?? []);
}

/** Recorded barriers are undirected: either face's mark supplies both directions. */
export const AUDITED_ONE_SIDED_BARRIERS: { from: HexKey; to: HexKey; edge: string; sourceRef: string }[] = [];
const edges: BoardEdge[] = [];
for (const [key, cell] of cellsByKey) {
  const coord = hexes[key].coord;
  for (const direction of AUDITED_EDGE_DIRECTIONS) {
    const neighbourKey = hexKey({ q: coord.q + direction.q, r: coord.r + direction.r });
    const neighbour = cellsByKey.get(neighbourKey);
    if (!neighbour) continue;
    const ownMark = recordedEdges(cell).has(direction.name);
    const neighbourMark = recordedEdges(neighbour).has(direction.opposite);
    const hasBarrier = ownMark || neighbourMark;
    // Generic "water barrier" entries in the Great Lakes are lake crossings, including
    // the shared edge between 3/19 Lake edge and 4/19 Coast. Tile classes stay as audited.
    const barrier = !hasBarrier ? "none" : cell.tile === "Lake edge" || neighbour.tile === "Lake edge" ? "lake" : "sea";
    if (ownMark && !neighbourMark) AUDITED_ONE_SIDED_BARRIERS.push({ from: key, to: neighbourKey, edge: direction.name, sourceRef: cell.sourceRef });
    edges.push({ from: key, to: neighbourKey, barrier, enabled: true,
      sourceRef: `${cell.sourceRef}; ${neighbour.sourceRef}`,
      notes: hasBarrier ? `Union of printed ${direction.name}/${direction.opposite} marks; ${ownMark && neighbourMark ? "recorded on both faces" : "recorded on one face"}.` : "No water barrier recorded on either face.",
    });
  }
}
const core = {
  id: "human-audited-north-america", version: 1, name: "Human-audited North America board",
  rulesetVersion: "audited-1.0", hexes, edges,
};
/** Separate identity preserves all legacy saved-game coordinates and content hashes. */
export const AUDITED_BOARD: BoardDefinition = { ...core, contentHash: boardContentHash(core) };
