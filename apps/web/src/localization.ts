export type RuleReference =
  | "turn-order"
  | "monster-movement"
  | "stomping-a-city"
  | "deploying"
  | "retreating-after-normal-battle"
  | "monster-challenge"
  | "attack-resolution";

export interface PracticeQuestion {
  readonly prompt: string;
  readonly choices: readonly string[];
  readonly answer: number;
  readonly explanation: string;
  readonly reference: RuleReference;
}

export interface MessageCatalog {
  readonly id: string;
  readonly name: string;
  readonly practice: {
    readonly summary: string;
    readonly accessibleName: string;
    readonly intro: string;
    readonly complete: (score: number, total: number) => string;
    readonly resultSummary: string;
    readonly referenceLinks: readonly { readonly href: string; readonly label: string }[];
    readonly tryAgain: string;
    readonly questionProgress: (current: number, total: number) => string;
    readonly correct: string;
    readonly incorrect: string;
    readonly reviewRule: string;
    readonly nextQuestion: string;
    readonly seeResult: string;
    readonly questions: readonly PracticeQuestion[];
  };
}

const english: MessageCatalog = {
  id: "en",
  name: "English",
  practice: {
    summary: "RULES PRACTICE",
    accessibleName: "Quick turn challenge",
    intro: "Fifteen quick questions about movement, encounters, stomping, deployment, turn order, retreating, combat, and the Monster Challenge. This practice stays in your browser and never changes a match.",
    complete: (score, total) => `Practice complete · ${score} of ${total} correct`,
    resultSummary: "Turn order: Move, Fight, Encounter, then Deploy or draw Research. Review the",
    referenceLinks: [
      { href: "/reference.html#turn-order", label: "turn sequence" },
      { href: "/reference.html#monster-movement", label: "movement rules" },
      { href: "/reference.html#stomping-a-city", label: "city benefits" },
      { href: "/reference.html#deploying", label: "deployment rules" },
      { href: "/reference.html#retreating-after-normal-battle", label: "retreat rules" },
      { href: "/reference.html#monster-challenge", label: "Monster Challenge" },
      { href: "/reference.html#attack-resolution", label: "attack rules" },
    ],
    tryAgain: "Try again",
    questionProgress: (current, total) => `Question ${current} of ${total}`,
    correct: "Correct.",
    incorrect: "Not quite.",
    reviewRule: "Review this rule",
    nextQuestion: "Next question",
    seeResult: "See result",
    questions: [
      { prompt: "What comes immediately after the Move phase?", choices: ["Fight", "Deploy", "Encounter"], answer: 0, explanation: "The turn order is Move, Fight, Encounter, then Deploy.", reference: "turn-order" },
      { prompt: "During Deploy, what can you choose instead of placing a unit?", choices: ["Take another Move", "Draw a Research card", "Skip the Encounter"], answer: 1, explanation: "The Deploy decision lets you deploy a branch unit or draw Research.", reference: "turn-order" },
      { prompt: "When is the Encounter decision made?", choices: ["Before Move", "After Fight", "After Deploy"], answer: 1, explanation: "Encounter follows Fight and comes before Deploy.", reference: "turn-order" },
      { prompt: "After a monster retreats from a normal battle, which spaces does it encounter?", choices: ["Neither the battle space nor its destination", "Only the destination", "Both spaces"], answer: 0, explanation: "A retreat prevents an Encounter at both the space the monster left and the space where it lands.", reference: "retreating-after-normal-battle" },
      { prompt: "What happens if a monster has no legal adjacent retreat space?", choices: ["It stays in the battle space", "It disappears", "It moves to Hollywood"], answer: 1, explanation: "If there is no legal retreat space, the monster disappears.", reference: "retreating-after-normal-battle" },
      { prompt: "Your units force an opponent monster to retreat. Who chooses its space, and what follows?", choices: ["The active player chooses, then draws Military Research", "The monster's owner chooses; nothing else happens", "The retreating player draws a Mutation"], answer: 0, explanation: "When the active player's units force a monster to retreat, that active player chooses a legal space and draws one Military Research card.", reference: "retreating-after-normal-battle" },
      { prompt: "Your monster moves through an unstomped city but ends its move elsewhere. Which space does it Encounter?", choices: ["The city it passed through", "Only the space where it stopped", "Both spaces"], answer: 1, explanation: "A monster Encounters only its final space; passing through a space does not resolve it.", reference: "monster-movement" },
      { prompt: "Which monster movement ability ignores every water barrier?", choices: ["Fly", "Lake", "Sea"], answer: 0, explanation: "Fly ignores water barriers. Lake crosses inland-water barriers only, while Sea crosses sea barriers.", reference: "monster-movement" },
      { prompt: "Your monster stomps a 2d city while below 40 Health. What does the city provide?", choices: ["Two Health", "Roll two dice and gain their total, up to 40 Health", "Roll one die and gain double"], answer: 1, explanation: "A 2d city grants the total of two dice, and monster Health cannot exceed 40.", reference: "stomping-a-city" },
      { prompt: "During Deploy, you choose to draw Military Research. What else may you deploy this turn?", choices: ["One unit from your own branch", "A National Guard unit", "No units; Research replaces deployment"], answer: 2, explanation: "Drawing one Military Research card is an alternative to deploying any units.", reference: "deploying" },
      { prompt: "Which monster becomes the Monster Challenge challenger when the active Stomp stack runs out?", choices: ["The monster whose player took the final marker", "The monster with the most Health", "The monster nearest a Challenge site"], answer: 0, explanation: "Taking the last marker from the active Stomp stack automatically makes that monster the challenger.", reference: "monster-challenge" },
      { prompt: "When does the challenger fight giant military units that are still in play?", choices: ["Before choosing any monster opponent", "After all eligible monster opponents are defeated", "Only if the challenger has no Mutation cards"], answer: 1, explanation: "The challenger resolves the eligible monster duels first, then challenges any surviving giant units last.", reference: "monster-challenge" },
      { prompt: "A giant defeats the monster challenger in the Monster Challenge. Who wins?", choices: ["The giant unit's controller", "The challenger’s controller", "The player who took the final Stomp marker"], answer: 0, explanation: "The giant unit's controller wins immediately when the giant defeats the challenger; this is the America-saved victory.", reference: "monster-challenge" },
      { prompt: "An attack hits a monster on a natural roll of 6. What does the smash add?", choices: ["One additional point of damage", "A second attack", "An automatic knockout"], answer: 0, explanation: "A natural 6 is a smash and deals 1 additional point of damage to a monster hit by the attack.", reference: "attack-resolution" },
      { prompt: "Before the Monster Challenge, what may a monster attack?", choices: ["Military units only", "Other monsters only", "Any piece in its space"], answer: 0, explanation: "Before the Monster Challenge, monsters may attack only military units.", reference: "attack-resolution" },
    ],
  },
};

export const MESSAGE_CATALOGS = { en: english } as const;
export type LocaleId = keyof typeof MESSAGE_CATALOGS;

export function resolveLocale(preferences: readonly string[] = []): LocaleId {
  for (const preference of preferences) {
    const base = preference.trim().toLowerCase().split(/[-_]/, 1)[0];
    if (base && Object.hasOwn(MESSAGE_CATALOGS, base)) return base as LocaleId;
  }
  return "en";
}

export function catalogFor(locale: string | undefined): MessageCatalog {
  const id = resolveLocale(locale ? [locale] : []);
  return MESSAGE_CATALOGS[id];
}
