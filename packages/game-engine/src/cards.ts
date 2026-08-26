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

export type CardStackingPolicy = "additive" | "replacement" | "permission-or" | "source-gated";

export interface CardStackingRule {
  readonly cardId: string;
  readonly effectKey: string;
  readonly policy: CardStackingPolicy;
  readonly sourceRefs: readonly string[];
  readonly rationale: string;
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
  "2nd Generation", "Anti-Mutagen", "Scientific Analysis", "Defense Satellites", "Antimatter", "Stabilizer Ray", "Laser Fence", "Blonde Lure", "Mecha-Monster", "Captain Colossal", "X-Fighters",
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
    id: "Fins and Gills",
    transcription: "You can cross water barriers.\n+1 Defense in a space with a water barrier.",
    classification: "persistent",
    timing: "Continuous; the Defense modifier is conditional on the monster's space.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Rampage",
    transcription: "You can move on the same turn you emerge from a lair.",
    classification: "persistent",
    timing: "When emerging from a lair.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Radiation Field",
    transcription: "Any time a military unit gets an attack roll of 1 against you, it destroys itself (you still draw Mutation cards, if applicable).",
    classification: "persistent",
    timing: "Immediately after a military unit rolls 1 when attacking this monster.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Atomic Recovery",
    transcription: "At the beginning of your turn, your Health returns to its starting value if it was lower.",
    classification: "persistent",
    timing: "Beginning of your turn, if Health is below starting Health.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Berserk",
    transcription: "Discard this card for 5 extra attacks at any time during a battle you're in.",
    classification: "one-use/discard",
    timing: "Any time during a battle involving this monster.",
    duration: "For the five additional attacks granted by this use.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "War Spikes",
    transcription: "Each of your hits deals 4 damage instead of 3.",
    classification: "persistent",
    timing: "Whenever this monster deals damage with a hit.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Atomic Breath",
    transcription: "You get 1 extra attack in the first combat round of each battle.",
    classification: "persistent",
    timing: "First combat round of each battle.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Iron Stomach",
    transcription: "Whenever you stomp a military base, you may gain 3 Health instead of 1 Infamy.",
    classification: "persistent",
    timing: "When this monster stomps a military base.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Whip Tentacles",
    transcription: "Whenever you get an attack roll of 6, you immediately make 1 extra attack (you also smash, if applicable).",
    classification: "persistent",
    timing: "Immediately after this monster rolls 6 for an attack.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "High-Octane Blood",
    transcription: "+1 Move\nDuring the Monster Challenge, you attack first even if you're not the challenger.",
    classification: "persistent",
    timing: "Move modifier is continuous; attack-order effect applies during the Monster Challenge.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Son of a Monster",
    transcription: "Discard this card at any time during a battle you're in to get 2 extra attacks and 1 die of Health.",
    classification: "one-use/discard",
    timing: "Any time during a battle involving this monster.",
    duration: "The attacks are immediate; the Health gained remains until later changed.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Winged Horror",
    transcription: "+1 Move\nYou now fly.",
    classification: "persistent",
    timing: "Continuous while face up.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Kinda Friendly",
    transcription: "You can move through spaces occupied by National Guard units. If you end your move on a space with any Guard units, return those units to the National Guard record tile without fighting them.",
    classification: "persistent",
    timing: "During and immediately after this monster's movement involving National Guard units.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Laser Beam Eyes",
    transcription: "+2 to hit cruise missiles.",
    classification: "persistent",
    timing: "When this monster attacks cruise missiles.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Armored Scales",
    transcription: "+1 Defense\n-1 Move",
    classification: "persistent",
    timing: "Continuous while face up.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-04.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "It's a Robot!",
    transcription: "Each time a monster misses you during the Monster Challenge, it takes 1 damage from electrocution.",
    classification: "persistent",
    timing: "Immediately after another monster misses this monster during the Monster Challenge.",
    duration: "While face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/monster-mutation-04.jpg"],
    effectsImplementation: "implemented",
  },
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
    id: "Laser Fence",
    transcription: "Use at any time when a monster ends its move, but before battle. DISCARD THIS CARD AFTER USE. The monster must expend 2 Infamy tokens or retreat to an unoccupied adjacent space. (It doesn't encounter the new space.)",
    classification: "one-use/discard",
    timing: "After a monster ends its move but before battle.",
    duration: "Resolved immediately.",
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
  {
    id: "Fusion Cells",
    transcription: "Add 1 to the Move value of all of your units.",
    classification: "persistent",
    timing: "Continuous while face up.",
    duration: "Until removed from play.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Mecha-Monster",
    transcription: "You control the Mecha-Monster giant military unit. Place its piece on one of your bases and take its record tile. When Mecha-Monster reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.",
    classification: "one-use/discard",
    timing: "Resolve immediately when drawn; discard after placing the unit and taking its tile.",
    duration: "The placed unit remains until it reaches 0 Health.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Cutbacks",
    transcription: "Use on any of your turns. DISCARD THIS CARD AFTER USE. Remove a Research card from play.",
    classification: "one-use/discard",
    timing: "Any of your turns.",
    duration: "The chosen Research card is removed from play.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-01.jpg"],
    effectsImplementation: "source-gated",
  },
  {
    id: "X-Fighters",
    transcription: "Place the 2 black X-fighter pieces on this card. You may deploy an X-fighter instead of a unit from your branch (but not instead of a Guard unit). Remove destroyed X-fighters from the game. (Discard this card after both are destroyed.)\nMove: 6 (fly)   Defense: 5   Damage: 2",
    classification: "persistent",
    timing: "Place both pieces on the card immediately; each may be deployed during a legal deploy in place of a branch unit.",
    duration: "Until both X-Fighters are destroyed, then discard.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Molecular Cannon",
    transcription: "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Roll 1 die. The monster takes that much damage and immediately appears on one of its lairs (your choice).",
    classification: "one-use/discard",
    timing: "Start of a battle involving your units, on any of your turns.",
    duration: "Resolved immediately before normal battle resolution.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "source-gated",
  },
  {
    id: "2nd Generation",
    transcription: "You can deploy 1 extra unit each turn (from your branch or from the National Guard).",
    classification: "persistent",
    timing: "During each of your Deploy steps while face up.",
    duration: "Until removed from play.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Blonde Lure",
    transcription: "Use on any of your turns. DISCARD THIS CARD AFTER USE. Choose a monster and a space adjacent to it. If it is able to, that monster must end its move on that space during its next turn.",
    classification: "one-use/discard",
    timing: "Any of your turns; constrains the chosen monster's next turn if movement is possible.",
    duration: "Until the chosen monster completes its next Move step or cannot comply.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Anti-Mutagen",
    transcription: "At the start of any battle involving your units, the monster loses 1 Health for each Mutation card it has.",
    classification: "conditional",
    timing: "Start of any battle involving your units.",
    duration: "Resolved at each qualifying battle while face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-02.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Scientific Analysis",
    transcription: "At the start of any battle involving your units, the monster loses 1 Health.",
    classification: "conditional",
    timing: "Start of any battle involving your units.",
    duration: "Resolved at each qualifying battle while face up.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-03.jpg"],
    effectsImplementation: "implemented",
  },
  {
    id: "Chopper Lift",
    transcription: "Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die. Move a monster up to that many spaces. It loses 1 Infamy. It cannot end this move on a space containing another piece, on a sea space, or on an unstomped city, base, or Infamy site.",
    classification: "one-use/discard",
    timing: "Any of your turns.",
    duration: "Resolved immediately.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-03.jpg"],
    effectsImplementation: "source-gated",
  },
  {
    id: "Captain Colossal",
    transcription: "You control the Captain Colossal giant military unit. Place its piece on one of your bases and take its record tile. When Captain Colossal reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.",
    classification: "one-use/discard",
    timing: "Resolve immediately when drawn; discard after placing the unit and taking its tile.",
    duration: "The placed unit remains until it reaches 0 Health.",
    sourceRefs: ["references/monsters-menace-america/components/decks/military-research-03.jpg"],
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

const explicitStackingPolicies: Readonly<Record<string, Pick<CardStackingRule, "effectKey" | "policy" | "rationale">>> = {
  "High-Octane Blood": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move modifier composes with other sourced Move modifiers." },
  "Winged Horror": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move modifier composes with other sourced Move modifiers." },
  "Armored Scales": { effectKey: "moveBonus/defenseBonus", policy: "additive", rationale: "The sourced -1 Move and +1 Defense values are independent numeric modifiers." },
  "Fins and Gills": { effectKey: "waterBarrierDefenseBonus", policy: "additive", rationale: "The sourced conditional +1 Defense is an additive modifier at a water barrier." },
  "War Spikes": { effectKey: "damagePerHit", policy: "replacement", rationale: "The sourced text replaces the ordinary hit damage value with 4." },
  "Atomic Breath": { effectKey: "firstRoundAttackBonus", policy: "additive", rationale: "The sourced extra attack is added to the first-round allowance." },
  "Fusion Cells": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move applies to the holder's unit values." },
  "2nd Generation": { effectKey: "extraDeployments", policy: "additive", rationale: "The sourced extra deployment is added to the normal allowance." },
  "Guard Commander": { effectKey: "nationalGuardControl", policy: "permission-or", rationale: "The sourced control permission is a boolean command capability, not a numeric modifier." },
};

/**
 * Every inventoried card receives an explicit stacking record. Only policies
 * supported by the cited text are resolved; all other conflicts remain
 * source-gated instead of inheriting a generic card-game assumption.
 */
export const CARD_STACKING_RULES: readonly CardStackingRule[] = CARD_DEFINITIONS.map((card) => {
  const explicit = explicitStackingPolicies[card.id];
  const sourceRefs = sourcedCardRule(card.id)?.sourceRefs ?? [card.sourceCatalogue];
  return explicit
    ? { cardId: card.id, ...explicit, sourceRefs }
    : { cardId: card.id, effectKey: "all", policy: "source-gated" as const, sourceRefs, rationale: "The cited card text does not establish a complete conflict/stacking ruling at the current production boundary." };
});

export function cardStackingRule(cardId: string): CardStackingRule | undefined {
  return CARD_STACKING_RULES.find((rule) => rule.cardId === cardId);
}
