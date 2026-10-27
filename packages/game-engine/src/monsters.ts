import type { HexKey } from "./board.js";

export type MonsterMovement = "land-only" | "land-lake" | "land-lake-sea" | "fly";

export interface MonsterDefinition {
  readonly id: "zorb" | "tomanagi" | "gargantis" | "megaclaw" | "konk" | "toxicor";
  readonly name: string;
  readonly startingHealth: number;
  readonly move: number;
  readonly movement: MonsterMovement;
  readonly defense: number;
  readonly attacks: number;
  readonly damage: number;
  readonly specialAbilityText: string;
  readonly sourceRefs: readonly string[];
  /** Board cells containing this monster's three human-reviewed lair symbols. */
  readonly lairs: readonly [HexKey, HexKey, HexKey];
  readonly lairsSourceRef: "docs/authoritative-board-human-audit.md";
  /** All six printed monster abilities are resolved at their authoritative timing boundaries. */
  readonly specialAbilityImplementation: "implemented";
}

const record = (file: string): readonly string[] => [
  `references/monsters-menace-america/components/monster-records/${file}`,
];

export const MONSTER_DEFINITIONS: readonly MonsterDefinition[] = [
  {
    id: "zorb", name: "Zorb", startingHealth: 11, move: 4, movement: "land-only", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "May get 2 Infamy tokens instead of gaining health for stomping a city. If a health roll is needed, decide after rolling.",
    sourceRefs: record("zorb-record-and-piece.jpg"), lairs: ["5,5", "13,4", "19,2"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
  {
    id: "tomanagi", name: "Tomanagi", startingHealth: 11, move: 4, movement: "land-lake-sea", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "1 extra attack in the first round of combat in a sea or seacoast space.",
    sourceRefs: record("tomanagi-record-and-piece.jpg"), lairs: ["2,9", "15,4", "21,0"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
  {
    id: "gargantis", name: "Gargantis", startingHealth: 10, move: 3, movement: "fly", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "May discard Mutation cards at any time to gain 3 health apiece.",
    sourceRefs: record("gargantis-record-and-piece.jpg"), lairs: ["3,5", "8,7", "10,-1"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
  {
    id: "megaclaw", name: "Megaclaw", startingHealth: 12, move: 4, movement: "land-lake", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "Get 3 Infamy tokens instead of 2 for stomping an Infamy site.",
    sourceRefs: record("megaclaw-record-and-piece.jpg"), lairs: ["13,-5", "14,4", "18,1"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
  {
    id: "konk", name: "Konk", startingHealth: 10, move: 4, movement: "land-only", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "+1 to hit fighters.",
    sourceRefs: record("konk-record-and-piece.jpg"), lairs: ["2,3", "13,1", "17,-1"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
  {
    id: "toxicor", name: "Toxicor", startingHealth: 9, move: 4, movement: "land-lake", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "When this monster mutates, draw 2 Mutation cards and pick one. Shuffle the other one back into the Mutation deck.",
    sourceRefs: record("toxicor-record-and-piece.jpg"), lairs: ["2,2", "14,-4", "19,-6"], lairsSourceRef: "docs/authoritative-board-human-audit.md", specialAbilityImplementation: "implemented",
  },
];

export function monsterDefinition(id: string): MonsterDefinition | undefined {
  return MONSTER_DEFINITIONS.find((monster) => monster.id === id);
}
