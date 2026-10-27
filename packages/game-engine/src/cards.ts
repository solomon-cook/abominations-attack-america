/** Versioned source-cited card metadata; production interaction and promotion gates are tracked separately. */
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
  readonly visibility: "face-up-public";
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

export type CardStackingPolicy = "additive" | "replacement" | "permission-or" | "remove-from-play" | "source-gated";

export interface CardStackingRule {
  readonly cardId: string;
  readonly effectKey: string;
  readonly policy: CardStackingPolicy;
  readonly sourceRefs: readonly string[];
  readonly rationale: string;
}

export interface CardInteractionRule {
  readonly cardIds: readonly [string, string];
  readonly policy: "additive" | "independent-windows" | "explicitly-excluded";
  readonly rationale: string;
  readonly sourceRefs: readonly string[];
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
  "2nd Generation", "Anti-Mutagen", "Scientific Analysis", "Defense Satellites", "Antimatter", "Stabilizer Ray", "Laser Fence", "Blonde Lure", "Mecha-Monster", "Captain Colossal", "X-Fighters", "Cutbacks", "Molecular Cannon", "Chopper Lift",
]);

export const MONSTER_MUTATION_CARD_IDS = mutationIds;
export const MILITARY_RESEARCH_CARD_IDS = researchIds;
export const CARD_DEFINITIONS: readonly CardDefinition[] = [
  ...mutationIds.map((id) => ({ id, deck: "mutation" as const, availability: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const, presentationKey: id, sourceCatalogue: catalogue, owner: "unknown" as const, zone: "deck" as const, visibility: "face-up-public" as const, duration: "unknown" as const, uses: "unknown" as const, targets: "unknown" as const, lifecycle: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const })),
  ...researchIds.map((id) => ({ id, deck: "research" as const, availability: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const, presentationKey: id, sourceCatalogue: catalogue, owner: "unknown" as const, zone: "deck" as const, visibility: "face-up-public" as const, duration: "unknown" as const, uses: "unknown" as const, targets: "unknown" as const, lifecycle: implementedCardIds.has(id) ? "implemented" as const : "source-gated" as const })),
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
    effectsImplementation: "implemented",
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
    effectsImplementation: "implemented",
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
    effectsImplementation: "implemented",
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
  "Rampage": { effectKey: "post-lair-move-permission", policy: "permission-or", rationale: "The card explicitly permits a Move on the turn the monster emerges from a lair; it grants that timing permission without adding movement distance." },
  "Atomic Recovery": { effectKey: "starting-health-reset", policy: "replacement", rationale: "The card explicitly restores Health to its starting value when current Health is lower; the named timing remains the owner's turn start." },
  "Iron Stomach": { effectKey: "base-stomp-encounter-reward", policy: "replacement", rationale: "The card explicitly offers 3 Health instead of the base-stomp reward of 1 Infamy." },
  "Kinda Friendly": { effectKey: "move-through-national-guard", policy: "permission-or", rationale: "The card explicitly permits movement through National Guard spaces and returns Guard at the endpoint without fighting." },
  "Laser Beam Eyes": { effectKey: "hit-bonus-vs-cruise-missiles", policy: "additive", rationale: "The card explicitly adds +2 to this monster's hit value against cruise missiles; the modifier is limited to that target class." },
  "High-Octane Blood": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move modifier composes with other sourced Move modifiers." },
  "Winged Horror": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move modifier composes with other sourced Move modifiers." },
  "Armored Scales": { effectKey: "moveBonus/defenseBonus", policy: "additive", rationale: "The sourced -1 Move and +1 Defense values are independent numeric modifiers." },
  "Fins and Gills": { effectKey: "waterBarrierDefenseBonus", policy: "additive", rationale: "The sourced conditional +1 Defense is an additive modifier at a water barrier." },
  "War Spikes": { effectKey: "damagePerHit", policy: "replacement", rationale: "The sourced text replaces the ordinary hit damage value with 4." },
  "Atomic Breath": { effectKey: "firstRoundAttackBonus", policy: "additive", rationale: "The sourced extra attack is added to the first-round allowance." },
  "Whip Tentacles": { effectKey: "firstRoundAttackBonus/triggeredExtraAttack", policy: "additive", rationale: "Its sourced immediate attack after a natural six adds to other battle attack grants." },
  "Berserk": { effectKey: "bonusMonsterAttacks", policy: "additive", rationale: "Its five battle attacks add to other separately granted attacks in that battle." },
  "Son of a Monster": { effectKey: "bonusMonsterAttacks/health", policy: "additive", rationale: "Its two battle attacks and Health gain resolve alongside independent battle effects." },
  "Anti-Mutagen": { effectKey: "battleStartHealthLoss", policy: "additive", rationale: "Its sourced battle-start Health loss composes with Scientific Analysis's separate battle-start Health loss." },
  "Scientific Analysis": { effectKey: "battleStartHealthLoss", policy: "additive", rationale: "Its sourced battle-start Health loss composes with Anti-Mutagen's separate battle-start Health loss." },
  "Fusion Cells": { effectKey: "moveBonus", policy: "additive", rationale: "The sourced +1 Move applies to the holder's unit values." },
  "X-Fighters": { effectKey: "branch-unit-deployment-substitution", policy: "replacement", rationale: "The card explicitly permits an X-Fighter to replace a branch unit deployment and explicitly excludes National Guard units." },
  "2nd Generation": { effectKey: "extraDeployments", policy: "additive", rationale: "The sourced extra deployment is added to the normal allowance." },
  "Guard Commander": { effectKey: "nationalGuardControl", policy: "permission-or", rationale: "The sourced control permission is a boolean command capability, not a numeric modifier." },
  "Cutbacks": { effectKey: "publicResearchCardLifecycle", policy: "remove-from-play", rationale: "The card explicitly removes a face-up Research card from play; its implemented lifecycle removes the target from its owner's active cards and ends its persistent effect." },
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

/** Pairwise rulings are recorded only where the cited card text establishes both windows. */
function sourcedPair(
  cardIds: readonly [string, string],
  policy: CardInteractionRule["policy"],
  rationale: string,
  additionalSources: readonly string[] = [],
): CardInteractionRule {
  return {
    cardIds,
    policy,
    rationale,
    sourceRefs: [...new Set([...cardIds.flatMap((id) => sourcedCardRule(id)?.sourceRefs ?? []), ...additionalSources])],
  };
}

export const CARD_INTERACTION_RULES: readonly CardInteractionRule[] = [
  sourcedPair(
    ["Defense Satellites", "Mecha-Monster"],
    "explicitly-excluded",
    "Defense Satellites explicitly says it does not affect Mecha-Monster; the giant takes no damage from this card's roll.",
  ),
  sourcedPair(
    ["Defense Satellites", "Captain Colossal"],
    "explicitly-excluded",
    "Defense Satellites explicitly says it does not affect Captain Colossal; the giant takes no damage from this card's roll.",
  ),
  sourcedPair(
    ["High-Octane Blood", "Winged Horror"],
    "additive",
    "Each Mutation independently grants its printed +1 Move modifier while active, so a monster holding both receives +2 Move; the modifier is reflected in the shared effective-stat and legal-path calculation.",
  ),
  sourcedPair(
    ["High-Octane Blood", "Armored Scales"],
    "additive",
    "High-Octane Blood adds one Move while Armored Scales subtracts one Move and adds one Defense. The printed Move modifiers offset to the monster's unmodified Move, while the independent Defense bonus remains active.",
  ),
  sourcedPair(
    ["Anti-Mutagen", "Scientific Analysis"],
    "additive",
    "Both cards independently remove their printed Health amount at the start of a qualifying battle, so both losses resolve before ordinary attacks.",
  ),
  sourcedPair(
    ["Anti-Mutagen", "Radiation Field"],
    "independent-windows",
    "Anti-Mutagen removes Health at battle start based on the monster's Mutation count; Radiation Field separately destroys a military attacker after its natural-one roll.",
  ),
  sourcedPair(
    ["Antimatter", "Radiation Field"],
    "independent-windows",
    "Antimatter doubles military damage on first-round hits; Radiation Field destroys a military unit after its natural-one attack roll. If a natural one meets the target's Defense, the attack still hits and receives Antimatter's doubled damage and Mutation roll before the attacker is destroyed; otherwise it misses and deals no Antimatter damage.",
  ),
  sourcedPair(
    ["Radiation Field", "Stabilizer Ray"],
    "independent-windows",
    "Radiation Field destroys a military unit after its natural-one attack roll; if that roll meets the monster's Defense and damages it, Stabilizer Ray also opens its post-damage choice to discard one of that monster's Mutation cards. Both effects resolve from the same attack result.",
  ),
  sourcedPair(
    ["Radiation Field", "Whip Tentacles"],
    "independent-windows",
    "Radiation Field destroys an opposing military unit after its natural-one attack roll against the monster; Whip Tentacles grants the monster an immediate extra attack after its natural-six roll. Both independent roll-trigger windows resolve when their respective rolls occur in the same battle.",
  ),
  sourcedPair(
    ["Atomic Recovery", "Anti-Mutagen"],
    "independent-windows",
    "Atomic Recovery restores a monster's Health at the beginning of its turn; Anti-Mutagen later removes Health at the start of a battle involving the opposing player's units.",
  ),
  sourcedPair(
    ["Berserk", "Son of a Monster"],
    "additive",
    "Each one-use card independently grants its printed extra attacks during the battle; using both adds five and two attacks, respectively.",
  ),
  sourcedPair(
    ["Berserk", "Whip Tentacles"],
    "additive",
    "Berserk grants its five extra attacks, and Whip Tentacles adds an immediate attack after each natural six; both attack sources apply during the same battle.",
  ),
  sourcedPair(
    ["Son of a Monster", "Whip Tentacles"],
    "additive",
    "Son of a Monster grants its two extra attacks, and Whip Tentacles adds an immediate attack after each natural six; both attack sources apply during the same battle.",
  ),
  sourcedPair(
    ["War Spikes", "Berserk"],
    "additive",
    "War Spikes applies its 4-damage value to every monster hit, including any of the five attacks granted by Berserk during the battle.",
  ),
  sourcedPair(
    ["War Spikes", "Son of a Monster"],
    "additive",
    "War Spikes applies its 4-damage value to every monster hit, including either of the two attacks granted by Son of a Monster during the battle.",
  ),
  sourcedPair(
    ["War Spikes", "Atomic Breath"],
    "additive",
    "War Spikes applies its 4-damage value to every monster hit, including Atomic Breath's additional first-round attack.",
  ),
  sourcedPair(
    ["War Spikes", "Whip Tentacles"],
    "additive",
    "War Spikes applies its 4-damage value to every monster hit, including the immediate extra attack Whip Tentacles grants after a natural six.",
  ),
  sourcedPair(
    ["Atomic Breath", "Whip Tentacles"],
    "additive",
    "Atomic Breath grants one first-round attack; Whip Tentacles grants a separate immediate attack after each natural six. Both triggers apply when their conditions occur.",
  ),
  sourcedPair(
    ["Atomic Breath", "Berserk"],
    "additive",
    "Atomic Breath adds one attack to the first combat round of every battle, and Berserk grants five extra attacks when discarded during that battle. When Berserk is used before the first round resolves, both printed grants apply to that battle.",
  ),
  sourcedPair(
    ["Atomic Breath", "Son of a Monster"],
    "additive",
    "Atomic Breath adds one attack to the first combat round of every battle, and Son of a Monster grants two extra attacks when discarded during that battle. When it is used before the first round resolves, both printed grants apply to that battle.",
  ),
  sourcedPair(
    ["Fins and Gills", "Armored Scales"],
    "additive",
    "Armored Scales grants its persistent Defense point in every space, and Fins and Gills adds a separate conditional Defense point at a water barrier.",
  ),
  sourcedPair(
    ["Fins and Gills", "Winged Horror"],
    "additive",
    "Winged Horror grants its printed flight and Move bonus; Fins and Gills independently grants its conditional Defense bonus at a water barrier, which remains active while the monster flies.",
  ),
  sourcedPair(
    ["Rampage", "Winged Horror"],
    "additive",
    "Rampage permits a monster to move on the turn it returns from a lair, while Winged Horror's separate Move bonus and flight apply to that movement.",
  ),
  sourcedPair(
    ["Atomic Recovery", "Iron Stomach"],
    "independent-windows",
    "Iron Stomach replaces the military-base stomp reward with a Health-or-Infamy choice during Encounter; Atomic Recovery restores Health below the monster's starting value at the beginning of its next turn. Both printed windows resolve, in turn order, without replacing or suppressing the other.",
    ["tmp/pdfs/rulebook-pages/page-06.jpg"],
  ),
  sourcedPair(
    ["2nd Generation", "X-Fighters"],
    "additive",
    "2nd Generation adds one deployment from the player's branch or National Guard; X-Fighters may replace a branch unit deployment, so an X-Fighter can use the added branch deployment slot.",
  ),
  sourcedPair(
    ["Fusion Cells", "X-Fighters"],
    "additive",
    "Fusion Cells adds 1 Move to all of its holder's units, and X-Fighters are owned, fly-capable military units, so the same Move bonus applies to them while the card remains in play.",
  ),
  sourcedPair(
    ["Fusion Cells", "Mecha-Monster"],
    "additive",
    "Fusion Cells adds 1 Move to all of its holder's units, and Mecha-Monster is a controlled giant military unit with a Move value, so its effective Move receives the same bonus while Fusion Cells remains in play.",
  ),
  sourcedPair(
    ["Fusion Cells", "Captain Colossal"],
    "additive",
    "Fusion Cells adds 1 Move to all of its holder's units, and Captain Colossal is a controlled giant military unit with a Move value, so its effective Move receives the same bonus while Fusion Cells remains in play.",
  ),
  sourcedPair(
    ["Laser Fence", "Chopper Lift"],
    "independent-windows",
    "Laser Fence triggers when a monster ends its move before battle, and Chopper Lift moves a monster on any of the cardholder's turns. The literal card wording therefore opens the Laser Fence reaction after Chopper Lift resolves; retreating the moved monster suppresses an Encounter only when that monster owns the active player's pending Encounter.",
  ),
  sourcedPair(
    ["Blonde Lure", "Laser Fence"],
    "independent-windows",
    "Blonde Lure's endpoint requirement is satisfied when the monster ends its Move on the chosen space. Laser Fence explicitly opens afterward, when a monster ends its move but before battle; its separate retreat does not undo the completed Move or trigger a new Encounter.",
  ),
  sourcedPair(
    ["Blonde Lure", "Chopper Lift"],
    "independent-windows",
    "Blonde Lure constrains the monster's next turn, while Chopper Lift moves a monster on the cardholder's turn. A Chopper Lift before the target's next turn does not satisfy or consume the lure; the chosen endpoint remains required on the target's next Move when reachable.",
  ),
  sourcedPair(
    ["Blonde Lure", "Molecular Cannon"],
    "independent-windows",
    "Blonde Lure requires the monster to end its Move at the chosen adjacent space during its next turn, while Molecular Cannon relocates it to a lair at the start of a battle. That earlier relocation does not satisfy or consume the lure; the chosen endpoint remains required on the target's next Move when reachable.",
  ),
  sourcedPair(
    ["Antimatter", "Molecular Cannon"],
    "independent-windows",
    "Both cards may be used at the start of a qualifying battle. Molecular Cannon used first removes the battle before Antimatter can be used; Antimatter used first is discarded and armed, but a later Molecular Cannon cancels the battle before its first combat round, so the Antimatter modifier never applies.",
  ),
  sourcedPair(
    ["Antimatter", "Stabilizer Ray"],
    "independent-windows",
    "Both cards may be used at the start of a qualifying battle. When a first-round military hit damages the monster, Antimatter doubles that hit and Stabilizer Ray opens its printed choice to discard one of the monster's Mutation cards.",
  ),
  sourcedPair(
    ["Kinda Friendly", "Guard Commander"],
    "independent-windows",
    "Guard Commander grants its holder control of neutral Guard units, while Kinda Friendly explicitly returns any Guard units the monster passes through or ends its move with to the record tile without battle. Returning a Guard unit does not remove Guard Commander or permanently remove the unit.",
  ),
  sourcedPair(
    ["Cutbacks", "Guard Commander"],
    "independent-windows",
    "Cutbacks removes Guard Commander from play, ending its movement, deployment, and redeployment permission; deployed Guard units remain in the neutral inventory and are no longer controlled by that player.",
  ),
];

function cardPairKey(cardIds: readonly [string, string]): string {
  return [...cardIds].sort().join("\u0000");
}

export function cardInteractionRule(firstCardId: string, secondCardId: string): CardInteractionRule | undefined {
  const requestedKey = cardPairKey([firstCardId, secondCardId]);
  return CARD_INTERACTION_RULES.find((rule) => cardPairKey(rule.cardIds) === requestedKey);
}
