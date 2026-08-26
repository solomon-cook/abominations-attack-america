export type HexCoord = Readonly<{ q: number; r: number }>;
export type HexKey = `${number},${number}`;
export type OffBoardPosition = "record-tile" | "hollywood" | "disappeared" | "trophy" | "defeated" | "permanently-removed";
export type SpaceKey = HexKey | OffBoardPosition;
export type WaterClass = "land" | "lake" | "sea" | "seacoast" | "unresolved";
export type WaterBarrier = "none" | "lake" | "sea" | "unresolved";
export type BoardVerification = "verified" | "provisional" | "unresolved";

export type CityBenefit =
  | Readonly<{ kind: "health"; amount: 1 | 2 }>
  | Readonly<{ kind: "health-roll"; dice: 1 | 2 | 3 }>;

export type BoardFeature =
  | Readonly<{ kind: "city"; benefit: CityBenefit }>
  | Readonly<{ kind: "military-base"; branch: "Army" | "Navy" | "Air Force" | "Marines" }>
  | Readonly<{ kind: "infamy-site" }>
  | Readonly<{ kind: "mutation-site"; siteId: string }>
  | Readonly<{ kind: "challenge-site" }>
  | Readonly<{ kind: "lair"; monsterId: string }>
  | Readonly<{ kind: "hollywood" }>
  | Readonly<{ kind: "los-angeles" }>;

export interface BoardHex {
  readonly key: HexKey;
  readonly coord: HexCoord;
  readonly label?: string;
  readonly waterClass: WaterClass;
  readonly features: readonly BoardFeature[];
  readonly sourceRefs: readonly string[];
  readonly verification: BoardVerification;
  readonly notes?: string;
}

export interface BoardEdge {
  readonly from: HexKey;
  readonly to: HexKey;
  readonly barrier: WaterBarrier;
  readonly enabled: boolean;
  readonly sourceRef: string;
  readonly exceptional?: boolean;
  readonly notes?: string;
}

export interface BoardDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly rulesetVersion: string;
  readonly contentHash: string;
  readonly hexes: Readonly<Record<HexKey, BoardHex>>;
  readonly edges: readonly BoardEdge[];
}

export interface BoardIndex {
  readonly neighbours: Readonly<Record<HexKey, readonly HexKey[]>>;
  readonly featureHexes: Readonly<Record<BoardFeature["kind"], readonly HexKey[]>>;
}

export interface BoardDiagnostics {
  readonly connectedComponents: readonly (readonly HexKey[])[];
  readonly isolatedHexes: readonly HexKey[];
  readonly disabledOnlyHexes: readonly HexKey[];
  readonly duplicateLabels: readonly string[];
  readonly duplicateCoordinates: readonly HexCoord[];
  readonly featureCounts: Readonly<Record<BoardFeature["kind"], number>>;
}

export const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
] as const;

export function hexKey({ q, r }: HexCoord): HexKey {
  return `${q},${r}`;
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const aq = a.q; const ar = a.r; const az = -aq - ar;
  const bq = b.q; const br = b.r; const bz = -bq - br;
  return Math.max(Math.abs(aq - bq), Math.abs(ar - br), Math.abs(az - bz));
}

function canonicalPayload(input: Omit<BoardDefinition, "contentHash">): string {
  const hexes = (Object.keys(input.hexes) as HexKey[]).sort().map((key) => input.hexes[key]);
  const edges = [...input.edges].sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`));
  return JSON.stringify({ id: input.id, version: input.version, name: input.name, rulesetVersion: input.rulesetVersion, hexes, edges });
}

function fnv1a(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function boardContentHash(input: Omit<BoardDefinition, "contentHash">): string {
  return fnv1a(canonicalPayload(input));
}

export function buildBoardIndex(board: BoardDefinition): BoardIndex {
  const neighbours = Object.fromEntries(Object.keys(board.hexes).map((key) => [key, [] as HexKey[]])) as Record<HexKey, HexKey[]>;
  const featureKinds: BoardFeature["kind"][] = ["city", "military-base", "infamy-site", "mutation-site", "challenge-site", "lair", "hollywood", "los-angeles"];
  const featureHexes = Object.fromEntries(featureKinds.map((kind) => [kind, [] as HexKey[]])) as Record<BoardFeature["kind"], HexKey[]>;
  for (const edge of board.edges) if (edge.enabled) neighbours[edge.from].push(edge.to);
  for (const hex of Object.values(board.hexes)) for (const feature of hex.features) featureHexes[feature.kind].push(hex.key);
  return { neighbours, featureHexes };
}

export function diagnoseBoard(board: BoardDefinition): BoardDiagnostics {
  const keys = Object.keys(board.hexes) as HexKey[];
  const enabledNeighbours = new Map<HexKey, Set<HexKey>>(keys.map((key) => [key, new Set()]));
  const allIncidentEdges = new Map<HexKey, number>(keys.map((key) => [key, 0]));
  for (const edge of board.edges) {
    allIncidentEdges.set(edge.from, (allIncidentEdges.get(edge.from) ?? 0) + 1);
    allIncidentEdges.set(edge.to, (allIncidentEdges.get(edge.to) ?? 0) + 1);
    if (edge.enabled) {
      enabledNeighbours.get(edge.from)?.add(edge.to);
      enabledNeighbours.get(edge.to)?.add(edge.from);
    }
  }
  const connectedComponents: HexKey[][] = [];
  const remaining = new Set(keys);
  while (remaining.size > 0) {
    const start = remaining.values().next().value as HexKey;
    const component: HexKey[] = [];
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const key = queue.shift()!;
      component.push(key);
      for (const neighbour of enabledNeighbours.get(key) ?? []) {
        if (remaining.delete(neighbour)) queue.push(neighbour);
      }
    }
    connectedComponents.push(component.sort());
  }
  const labelCounts = new Map<string, number>();
  const coordinateCounts = new Map<string, number>();
  const featureCounts = Object.fromEntries([
    "city", "military-base", "infamy-site", "mutation-site", "challenge-site", "lair", "hollywood", "los-angeles",
  ].map((kind) => [kind, 0])) as Record<BoardFeature["kind"], number>;
  for (const hex of Object.values(board.hexes)) {
    if (hex.label) labelCounts.set(hex.label, (labelCounts.get(hex.label) ?? 0) + 1);
    const coordinate = `${hex.coord.q},${hex.coord.r}`;
    coordinateCounts.set(coordinate, (coordinateCounts.get(coordinate) ?? 0) + 1);
    for (const feature of hex.features) featureCounts[feature.kind] += 1;
  }
  return {
    connectedComponents,
    isolatedHexes: keys.filter((key) => (enabledNeighbours.get(key)?.size ?? 0) === 0),
    disabledOnlyHexes: keys.filter((key) => (enabledNeighbours.get(key)?.size ?? 0) === 0 && (allIncidentEdges.get(key) ?? 0) > 0),
    duplicateLabels: [...labelCounts.entries()].filter(([, count]) => count > 1).map(([label]) => label).sort(),
    duplicateCoordinates: [...coordinateCounts.entries()].filter(([, count]) => count > 1).map(([coordinate]) => {
      const [q, r] = coordinate.split(",").map(Number);
      return { q, r };
    }),
    featureCounts,
  };
}

export function validateBoardDefinition(board: BoardDefinition, options: { production?: boolean } = {}): string[] {
  const errors: string[] = [];
  const keys = Object.keys(board.hexes);
  if (new Set(keys).size !== keys.length) errors.push("duplicate hex keys");
  for (const [key, hex] of Object.entries(board.hexes)) {
    if (hex.key !== key) errors.push(`hex key mismatch for ${key}`);
    if (hexKey(hex.coord) !== key) errors.push(`hex coordinate mismatch for ${key}`);
    if (hex.sourceRefs.length === 0) errors.push(`hex ${key} has no source reference`);
    if (options.production && hex.verification !== "verified") errors.push(`hex ${key} is ${hex.verification}`);
    if (options.production && hex.waterClass === "unresolved") errors.push(`hex ${key} water class is unresolved`);
    for (const feature of hex.features) {
      if (feature.kind === "mutation-site" && !feature.siteId) errors.push(`hex ${key} mutation site has no site ID`);
      if (feature.kind === "lair" && !feature.monsterId) errors.push(`hex ${key} lair has no monster ID`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of board.edges) {
    if (!board.hexes[edge.from] || !board.hexes[edge.to]) errors.push(`edge references missing hex: ${edge.from}->${edge.to}`);
    const edgeKey = `${edge.from}->${edge.to}`;
    if (edgeKeys.has(edgeKey)) errors.push(`duplicate edge ${edgeKey}`);
    edgeKeys.add(edgeKey);
    if (!edge.sourceRef) errors.push(`edge ${edgeKey} has no source reference`);
    if (options.production && edge.barrier === "unresolved") errors.push(`edge ${edgeKey} barrier is unresolved`);
    if (!edge.exceptional && board.hexes[edge.from] && board.hexes[edge.to] && hexDistance(board.hexes[edge.from].coord, board.hexes[edge.to].coord) !== 1) {
      errors.push(`edge is not between neighbouring hexes: ${edgeKey}`);
    }
    if (edge.enabled && !edge.exceptional && !board.edges.some((candidate) => candidate.from === edge.to && candidate.to === edge.from && candidate.enabled)) {
      errors.push(`enabled edge is not reciprocal: ${edgeKey}`);
    }
  }
  const expectedHash = boardContentHash({ id: board.id, version: board.version, name: board.name, rulesetVersion: board.rulesetVersion, hexes: board.hexes, edges: board.edges });
  if (board.contentHash !== expectedHash) errors.push(`content hash mismatch: expected ${expectedHash}`);
  return errors;
}

type DevelopmentLocation = Readonly<{ id: string; name: string; coord: HexCoord; x: number; y: number; kind: "city" | "base" | "infamy" | "mutation" | "challenge"; marker?: string; links: readonly string[] }>;

/** The former nine-location graph, retained only as a named development fixture. */
export const DEVELOPMENT_LOCATIONS: readonly DevelopmentLocation[] = [
  { id: "seattle", name: "Seattle", coord: { q: -3, r: 0 }, x: 18, y: 20, kind: "city", marker: "1HP", links: ["denver", "san-francisco"] },
  { id: "san-francisco", name: "San Francisco", coord: { q: -3, r: 1 }, x: 18, y: 46, kind: "city", marker: "2D", links: ["seattle", "los-angeles"] },
  { id: "denver", name: "Denver", coord: { q: -1, r: 0 }, x: 40, y: 35, kind: "base", links: ["seattle", "chicago", "dallas", "los-angeles"] },
  { id: "chicago", name: "Chicago", coord: { q: 1, r: -1 }, x: 67, y: 24, kind: "city", marker: "2HP", links: ["denver", "new-york", "dallas"] },
  { id: "new-york", name: "New York", coord: { q: 3, r: -1 }, x: 85, y: 30, kind: "city", marker: "1D", links: ["chicago", "miami"] },
  { id: "los-angeles", name: "Los Angeles", coord: { q: -2, r: 2 }, x: 18, y: 65, kind: "city", marker: "3D", links: ["seattle", "denver", "dallas"] },
  { id: "infamy-site", name: "Infamy Site", coord: { q: -1, r: 1 }, x: 31, y: 55, kind: "infamy", links: ["denver", "dallas"] },
  { id: "dallas", name: "Dallas", coord: { q: 0, r: 2 }, x: 48, y: 65, kind: "mutation", links: ["denver", "chicago", "los-angeles", "miami"] },
  { id: "miami", name: "Miami", coord: { q: 2, r: 1 }, x: 80, y: 70, kind: "challenge", links: ["dallas", "new-york"] }
];

/** Compatibility names are accepted only at development/setup boundaries. Authoritative positions use these keys. */
export const DEVELOPMENT_LOCATION_KEYS: Readonly<Record<string, HexKey>> = Object.fromEntries(
  DEVELOPMENT_LOCATIONS.map((place) => [place.id, hexKey(place.coord)]),
) as Record<string, HexKey>;

export function isHexKey(value: string): value is HexKey {
  return Object.prototype.hasOwnProperty.call(DEVELOPMENT_LOCATION_KEYS, value)
    || /^-?\d+,-?\d+$/.test(value);
}

export function locationIdToHexKey(id: string): HexKey | undefined {
  return DEVELOPMENT_LOCATION_KEYS[id];
}

export function hexKeyToLocationId(key: string): string | undefined {
  return DEVELOPMENT_LOCATIONS.find((place) => hexKey(place.coord) === key)?.id;
}

/** Normalize a legacy development location name or a canonical hex key at a command boundary. */
export function toDevelopmentSpaceKey(value: string): SpaceKey | undefined {
  if (value in DEVELOPMENT_LOCATION_KEYS) return DEVELOPMENT_LOCATION_KEYS[value];
  if (value === "record-tile" || value === "hollywood" || value === "disappeared" || value === "trophy" || value === "defeated" || value === "permanently-removed") return value;
  return isHexKey(value) && DEVELOPMENT_BOARD.hexes[value] ? value : undefined;
}

function developmentCityBenefit(marker?: string): CityBenefit {
  if (marker?.endsWith("HP")) return { kind: "health", amount: Number(marker.slice(0, -2)) as 1 | 2 };
  return { kind: "health-roll", dice: Number(marker?.slice(0, -1) ?? 1) as 1 | 2 | 3 };
}

const developmentHexes = Object.fromEntries(DEVELOPMENT_LOCATIONS.map((place) => [
  hexKey(place.coord),
  {
    key: hexKey(place.coord), coord: place.coord, label: place.name, waterClass: "land" as const,
    features: place.kind === "city" ? [{ kind: "city", benefit: developmentCityBenefit(place.marker) }] : place.kind === "base" ? [{ kind: "military-base", branch: "Army" as const }] : place.kind === "infamy" ? [{ kind: "infamy-site" }] : place.kind === "mutation" ? [{ kind: "mutation-site", siteId: place.id }] : [{ kind: "challenge-site" }],
    sourceRefs: ["development-fixture"], verification: "unresolved" as const, notes: "Provisional topology; not the physical board."
  }
])) as Record<HexKey, BoardHex>;

/** Explicit reciprocal movement topology for the named development fixture. */
const developmentEdgePairs: readonly (readonly [string, string])[] = [
  ["seattle", "denver"], ["seattle", "san-francisco"], ["san-francisco", "los-angeles"], ["los-angeles", "seattle"],
  ["denver", "chicago"], ["denver", "dallas"], ["denver", "los-angeles"],
  ["chicago", "new-york"], ["chicago", "dallas"], ["new-york", "miami"],
  ["infamy-site", "denver"], ["infamy-site", "dallas"], ["dallas", "miami"]
];
const developmentEdges = developmentEdgePairs.flatMap(([from, to]) => [from, to].map((source, index) => {
  const target = index === 0 ? to : from;
  return {
    from: DEVELOPMENT_LOCATION_KEYS[source], to: DEVELOPMENT_LOCATION_KEYS[target], barrier: "none" as const,
    enabled: true, sourceRef: "development-fixture", exceptional: true
  };
}));

const developmentCore = { id: "development-nine-location", version: 1, name: "Nine-location development fixture", rulesetVersion: "prototype-0.1", hexes: developmentHexes, edges: developmentEdges };
export const DEVELOPMENT_BOARD: BoardDefinition = { ...developmentCore, contentHash: boardContentHash(developmentCore) };

/**
 * Complete coordinate shell inferred from the photographed board's visible
 * honeycomb lattice. Printed labels, water classes, features, and barriers are
 * intentionally unresolved until each hex is reviewed against the source.
 * This definition is evidence scaffolding, not a playable rules board.
 */
const FULL_HONEYCOMB_ROWS = 13;
const FULL_HONEYCOMB_SOURCE = "references/monsters-menace-america/components/board/full-game-setup.jpg#full-honeycomb-grid";

function fullHoneycombCoordinate(row: number, column: number): HexCoord {
  return { q: column - Math.floor(row / 2), r: row };
}

function fullHoneycombHexes(): Record<HexKey, BoardHex> {
  const hexes: Record<HexKey, BoardHex> = {};
  for (let row = 0; row < FULL_HONEYCOMB_ROWS; row += 1) {
    const columns = row % 2 === 0 ? 20 : 19;
    for (let column = 0; column < columns; column += 1) {
      const coord = fullHoneycombCoordinate(row, column);
      const key = hexKey(coord);
      hexes[key] = {
        key,
        coord,
        waterClass: "unresolved",
        features: [],
        sourceRefs: [FULL_HONEYCOMB_SOURCE],
        verification: "unresolved",
        notes: "Coordinate is present in the photographed full-board lattice; printed content requires review.",
      };
    }
  }
  return hexes;
}

function fullHoneycombEdges(hexes: Readonly<Record<HexKey, BoardHex>>): BoardEdge[] {
  const edges: BoardEdge[] = [];
  for (const hex of Object.values(hexes)) {
    for (const direction of HEX_DIRECTIONS) {
      const neighbour = hexKey({ q: hex.coord.q + direction.q, r: hex.coord.r + direction.r });
      if (!hexes[neighbour]) continue;
      edges.push({
        from: hex.key,
        to: neighbour,
        barrier: "unresolved",
        enabled: false,
        sourceRef: FULL_HONEYCOMB_SOURCE,
        notes: "Connection is present in the coordinate shell; barrier and movement status require review.",
      });
    }
  }
  return edges;
}

const fullHoneycombCore = {
  id: "full-honeycomb-board-candidate",
  version: 1,
  name: "Photographed full honeycomb board coordinate shell",
  rulesetVersion: "prototype-0.1",
  hexes: fullHoneycombHexes(),
  edges: [] as BoardEdge[],
};
fullHoneycombCore.edges = fullHoneycombEdges(fullHoneycombCore.hexes);

/** Full-board geometry candidate; production validation must reject it until source review completes. */
export const FULL_HONEYCOMB_BOARD: BoardDefinition = { ...fullHoneycombCore, contentHash: boardContentHash(fullHoneycombCore) };

/**
 * A separately pinned playtest board built from the current photographic
 * guesses. It is useful for local/test experiments, but is never production
 * ready: every cell remains explicitly provisional and its ruleset is named.
 */
const PROVISIONAL_BOARD_SOURCE = "docs/provisional-board-transcription.md#promoted-playtest-transcription-for-implementation-handoff";
const PROVISIONAL_BOARD_FEATURES: Readonly<Record<string, readonly BoardFeature[]>> = {
  "1/2": [{ kind: "city", benefit: { kind: "health", amount: 1 } }],
  "9/2": [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }],
  "11/4": [{ kind: "city", benefit: { kind: "health-roll", dice: 3 } }, { kind: "los-angeles" }],
  "2/7": [{ kind: "city", benefit: { kind: "health", amount: 1 } }],
  "3/8": [{ kind: "city", benefit: { kind: "health-roll", dice: 1 } }],
  "5/8": [{ kind: "city", benefit: { kind: "health-roll", dice: 1 } }],
  "6/8": [{ kind: "city", benefit: { kind: "health", amount: 1 } }],
  "3/13": [{ kind: "city", benefit: { kind: "health", amount: 2 } }],
  "4/17": [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }],
  "5/16": [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }],
  "7/13": [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }],
  "7/11": [{ kind: "city", benefit: { kind: "health-roll", dice: 1 } }],
  "2/5": [{ kind: "infamy-site" }],
  "4/8": [{ kind: "infamy-site" }],
  "7/5": [{ kind: "infamy-site" }],
  "9/5": [{ kind: "infamy-site" }],
  "10/14": [{ kind: "infamy-site" }],
  "4/10": [{ kind: "mutation-site", siteId: "provisional-mutation-1" }],
  "6/9": [{ kind: "mutation-site", siteId: "provisional-mutation-2" }],
  "8/7": [{ kind: "mutation-site", siteId: "provisional-mutation-3" }],
  "10/16": [{ kind: "challenge-site" }],
  "11/1": [{ kind: "hollywood" }],
  "0/2": [{ kind: "military-base", branch: "Navy" }],
  "1/9": [{ kind: "military-base", branch: "Air Force" }],
  "6/12": [{ kind: "military-base", branch: "Air Force" }],
  "9/11": [{ kind: "military-base", branch: "Air Force" }],
  "10/15": [{ kind: "military-base", branch: "Air Force" }],
  "6/18": [{ kind: "military-base", branch: "Marines" }],
  "7/17": [{ kind: "military-base", branch: "Marines" }],
  "8/17": [{ kind: "military-base", branch: "Marines" }],
  "7/14": [{ kind: "military-base", branch: "Army" }],
  "9/15": [{ kind: "military-base", branch: "Army" }],
  "10/10": [{ kind: "military-base", branch: "Navy" }],
  "11/13": [{ kind: "military-base", branch: "Navy" }],
};

function provisionalBoardHexes(): Record<HexKey, BoardHex> {
  return Object.fromEntries(Object.entries(FULL_HONEYCOMB_BOARD.hexes).map(([key, hex]) => {
    const row = hex.coord.r;
    const column = hex.coord.q + Math.floor(row / 2);
    const features = PROVISIONAL_BOARD_FEATURES[`${row}/${column}`] ?? [];
    return [key, {
      ...hex,
      label: features.some((feature) => feature.kind === "city") ? `Provisional city ${row}/${column}` : undefined,
      waterClass: (row === 0 || row === FULL_HONEYCOMB_ROWS - 1 || column === 0 || column === (row % 2 === 0 ? 19 : 18)) ? "seacoast" : "land",
      features,
      sourceRefs: [PROVISIONAL_BOARD_SOURCE, FULL_HONEYCOMB_SOURCE],
      verification: "provisional" as const,
      notes: "Promoted photographic guess for playtesting; replace with physical-board transcription when available.",
    } satisfies BoardHex];
  })) as Record<HexKey, BoardHex>;
}

const provisionalBoardCore = {
  id: "provisional-authoritative-honeycomb-board",
  version: 1,
  name: "Promoted photographed honeycomb board playtest definition",
  rulesetVersion: "playtest-0.2-promoted-guess",
  hexes: provisionalBoardHexes(),
  edges: FULL_HONEYCOMB_BOARD.edges.map((edge) => ({
    ...edge,
    barrier: "none" as const,
    enabled: true,
    sourceRef: PROVISIONAL_BOARD_SOURCE,
    notes: "Promoted adjacency guess; verify against the physical board.",
  })),
};

export const PROVISIONAL_AUTHORITATIVE_BOARD: BoardDefinition = { ...provisionalBoardCore, contentHash: boardContentHash(provisionalBoardCore) };
