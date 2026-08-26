import { writeFile } from "node:fs/promises";
import { CARD_DATA_VERSION, CARD_DEFINITIONS, sourcedCardRule, SOURCED_CARD_RULES } from "../packages/game-engine/src/cards.js";

const reportPath = new URL("../docs/card-catalogue-report.md", import.meta.url);
const available = CARD_DEFINITIONS.filter((card) => card.availability === "implemented");
const gated = CARD_DEFINITIONS.filter((card) => card.availability === "source-gated");

if (SOURCED_CARD_RULES.length !== CARD_DEFINITIONS.length) {
  throw new Error(`Source rule coverage mismatch: ${SOURCED_CARD_RULES.length} rules for ${CARD_DEFINITIONS.length} cards.`);
}
for (const card of CARD_DEFINITIONS) {
  const rule = sourcedCardRule(card.id);
  if (!rule || rule.id !== card.id || !rule.transcription.trim() || !rule.timing.trim() || !rule.duration.trim() || rule.sourceRefs.length === 0 || !rule.effectsImplementation) {
    throw new Error(`Card ${card.id} is missing complete source-backed rule metadata.`);
  }
}

const lines = [
  "# Card catalogue report",
  "",
  "This report is generated from `packages/game-engine/src/cards.ts`. It describes the `prototype-0.1` development ruleset only; it is not production approval while the physical board and source-gated card effects remain unresolved.",
  "",
  `- Card data version: ${CARD_DATA_VERSION}`,
  `- Total source-inventoried cards: ${CARD_DEFINITIONS.length}`,
  `- Available in the selected development ruleset: ${available.length}`,
  `- Source-gated and unavailable: ${gated.length}`,
  "",
  "## Available cards",
  "",
  "| Deck | Card | Classification | Effect status |",
  "| --- | --- | --- | --- |",
  ...available.map((card) => `| ${card.deck} | ${card.id} | ${sourcedCardRule(card.id)?.classification ?? "not catalogued"} | implemented |`),
  "",
  "## Source-gated cards",
  "",
  "These cards are rejected by `assertCardsAvailable` and cannot silently no-op in a selected ruleset.",
  "",
  "| Deck | Card | Source status |",
  "| --- | --- | --- |",
  ...gated.map((card) => `| ${card.deck} | ${card.id} | source-gated |`),
  "",
  "## Promotion boundary",
  "",
  "The report intentionally does not claim zero unsupported cards for production. Production selection remains blocked until every source-gated effect, Challenge giant-unit lifecycle, and authoritative board datum has been independently verified and implemented.",
  "",
];

async function main(): Promise<void> {
  await writeFile(reportPath, lines.join("\n"));
  console.log(`Generated ${new URL(reportPath).pathname} with ${available.length} available and ${gated.length} source-gated cards.`);
}

void main();
