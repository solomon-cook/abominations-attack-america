/** Versioned source-inventory metadata. Mechanics remain disabled until independently verified. */
export const CARD_DATA_VERSION = 1 as const;

export type CardDeck = "mutation" | "research";
export type CardAvailability = "source-gated" | "implemented";

export interface CardDeckState {
  readonly order: readonly string[];
  readonly drawIndex: number;
  readonly discard: readonly string[];
  readonly exhausted: boolean;
}

export interface CardDrawResult {
  readonly state: CardDeckState;
  readonly cardId?: string;
  readonly exhausted: boolean;
}

export function createCardDeckState(order: readonly string[]): CardDeckState {
  return { order: [...order], drawIndex: 0, discard: [], exhausted: false };
}

/** Draw is deterministic and only reveals the next already-shuffled card to the caller. */
export function drawCard(deck: CardDeckState): CardDrawResult {
  if (deck.drawIndex >= deck.order.length) return { state: { ...deck, exhausted: true }, exhausted: true };
  const cardId = deck.order[deck.drawIndex];
  return { state: { ...deck, drawIndex: deck.drawIndex + 1, exhausted: deck.drawIndex + 1 >= deck.order.length }, cardId, exhausted: false };
}

export function discardCard(deck: CardDeckState, cardId: string): CardDeckState {
  const cardIndex = deck.order.indexOf(cardId);
  if (cardIndex < 0 || cardIndex >= deck.drawIndex || deck.discard.includes(cardId)) {
    throw new Error(`Card ${cardId} is not an available card in this deck.`);
  }
  return { ...deck, discard: [...deck.discard, cardId] };
}

export interface CardDefinition {
  readonly id: string;
  readonly deck: CardDeck;
  readonly availability: CardAvailability;
  readonly presentationKey: string;
  readonly sourceCatalogue: string;
  readonly owner: "unknown";
  readonly zone: "deck";
  readonly visibility: "unknown";
  readonly duration: "unknown";
  readonly uses: "unknown";
  readonly targets: "unknown";
  readonly lifecycle: CardAvailability;
}

export interface SourcedCardRule {
  readonly id: string;
  readonly transcription: string;
  readonly classification: "persistent" | "immediate" | "conditional" | "one-use/discard";
  readonly timing: string;
  readonly duration: string;
  readonly sourceRefs: readonly string[];
  readonly effectsImplementation: CardAvailability;
}

const catalogue = "references/monsters-menace-america/component-rules-catalogue.json";
const mutationIds = [
  "Fins and Gills", "Rampage", "Radiation Field", "Atomic Recovery", "Berserk", "War Spikes",
  "Atomic Breath", "Iron Stomach", "Whip Tentacles", "High-Octane Blood", "Son of a Monster", "Winged Horror",
  "Kinda Friendly", "Laser Beam Eyes", "Armored Scales", "It's a Robot!",
] as const;
const researchIds = [
  "Mecha-Monster", "Cutbacks", "Laser Fence", "Guard Commander", "Defense Satellites", "Stabilizer Ray",
  "Fusion Cells", "X-Fighters", "Molecular Cannon", "2nd Generation", "Blonde Lure", "Anti-Mutagen",
  "Antimatter", "Scientific Analysis", "Chopper Lift", "Captain Colossal",
] as const;

/** Cards whose sourced rules are implemented at the current development ruleset boundary. */
const implementedCardIds = new Set<string>([
  "Fins and Gills", "Rampage", "Radiation Field", "Atomic Recovery", "War Spikes", "Atomic Breath",
  "Iron Stomach", "Whip Tentacles", "High-Octane Blood", "Son of a Monster", "Berserk", "Winged Horror", "Kinda Friendly",
  "Laser Beam Eyes", "Armored Scales", "It's a Robot!", "Guard Commander", "Fusion Cells",
  "2nd Generation", "Anti-Mutagen", "Scientific Analysis", "Defense Satellites", "Antimatter", "Stabilizer Ray",
]);

export const MONSTER_MUTATION_CARD_IDS = mutationIds;
export const MILITARY_RESEARCH_CARD_IDS = researchIds;
export const CARD_DEFINITIONS: readonly CardDefinition[] = [
  ...mutationIds.map((id) => ({ id, deck: "mutation" as const, availability: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const, presentationKey: id, sourceCatalogue: catalogue, owner: "unknown" as const, zone: "deck" as const, visibility: "unknown" as const, duration: "unknown" as const, uses: "unknown" as const, targets: "unknown" as const, lifecycle: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const })),
  ...researchIds.map((id) => ({ id, deck: "research" as const, availability: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const, presentationKey: id, sourceCatalogue: catalogue, owner: "unknown" as const, zone: "deck" as const, visibility: "unknown" as const, duration: "unknown" as const, uses: "unknown" as const, targets: "unknown" as const, lifecycle: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const })),
];

/** Exact component text promoted from the cited catalogue with implementation status. */
export const SOURCED_CARD_RULES: readonly SourcedCardRule[] = [
  {
    id: "Defense Satellites",
    transcription: "Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die for each monster on the game board. That monster takes that much damage. (This doesn't affect Captain Colossal or Mecha-Monster.)",
    classification: "one-use/discard",
    timing: "Any of your turns.",
    duration: "Resolved immediately.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Antimatter",
    transcription: "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Military units deal double damage in the first combat round. Each time the monster is damaged this way, roll 1 die. The monster mutates on a roll of 1.",
    classification: "one-use/discard",
    timing: "Start of a battle involving your units, on any of your turns.",
    duration: "Resolved immediately before normal battle resolution.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Stabilizer Ray",
    transcription: "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. If you damage a monster during this battle, choose and discard 1 of its Mutation cards.",
    classification: "one-use/discard",
    timing: "Start of a battle involving your units, on any of your turns.",
    duration: "For that battle.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Guard Commander",
    transcription: "You can move and redeploy Guard units. Tanks have Move 3 (land only). Fighters have Move 5 (fly). Other players can't deploy Guard units.",
    classification: "persistent",
    timing: "Continuous while face up.",
    duration: "Until removed from play.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "implemented",
  },
];

export function sourcedCardRule(id: string): SourcedCardRule | undefined {
  return SOURCED_CARD_RULES.find((card) => card.id === id);
}

export function cardDefinition(id: string): CardDefinition | undefined {
  return CARD_DEFINITIONS.find((card) => card.id === id);
}

export function unsupportedCardIds(cardIds: readonly string[] = CARD_DEFINITIONS.map((card) => card.id)): string[] {
  return cardIds.filter((id) => cardDefinition(id)?.availability !== "implemented");
}

export function assertCardsAvailable(cardIds: readonly string[]): void {
  const unsupported = unsupportedCardIds(cardIds);
  if (unsupported.length > 0) throw new Error(`Cards are source-gated and unavailable: ${unsupported.join(", ")}`);
}
