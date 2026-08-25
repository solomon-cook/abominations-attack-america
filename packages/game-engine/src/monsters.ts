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
  /** Lairs are intentionally separate: they require the reviewed board transcription. */
  readonly lairs: "source-gated";
  /** The card/site/combat execution of these abilities remains source-gated. */
  readonly specialAbilityImplementation: "source-gated";
}

const record = (file: string): readonly string[] => [
  `references/monsters-menace-america/components/monster-records/${file}`,
];

export const MONSTER_DEFINITIONS: readonly MonsterDefinition[] = [
  {
    id: "zorb", name: "Zorb", startingHealth: 11, move: 4, movement: "land-only", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "May get 2 Infamy tokens instead of gaining health for stomping a city. If a health roll is needed, decide after rolling.",
    sourceRefs: record("zorb-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
  {
    id: "tomanagi", name: "Tomanagi", startingHealth: 11, move: 4, movement: "land-lake-sea", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "1 extra attack in the first round of combat in a sea or seacoast space.",
    sourceRefs: record("tomanagi-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
  {
    id: "gargantis", name: "Gargantis", startingHealth: 10, move: 3, movement: "fly", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "May discard Mutation cards at any time to gain 3 health apiece.",
    sourceRefs: record("gargantis-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
  {
    id: "megaclaw", name: "Megaclaw", startingHealth: 12, move: 4, movement: "land-lake", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "Get 3 Infamy tokens instead of 2 for stomping an Infamy site.",
    sourceRefs: record("megaclaw-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
  {
    id: "konk", name: "Konk", startingHealth: 10, move: 4, movement: "land-only", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "+1 to hit fighters.",
    sourceRefs: record("konk-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
  {
    id: "toxicor", name: "Toxicor", startingHealth: 9, move: 4, movement: "land-lake", defense: 4, attacks: 3, damage: 3,
    specialAbilityText: "When this monster mutates, draw 2 Mutation cards and pick one. Shuffle the other one back into the Mutation deck.",
    sourceRefs: record("toxicor-record-and-piece.jpg"), lairs: "source-gated", specialAbilityImplementation: "source-gated",
  },
];

export function monsterDefinition(id: string): MonsterDefinition | undefined {
  return MONSTER_DEFINITIONS.find((monster) => monster.id === id);
}
