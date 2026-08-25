import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const catalogueDirectory = join(root, "references", "monsters-menace-america");
const inputPath = join(catalogueDirectory, "component-rules-catalogue.json");
const outputPath = join(catalogueDirectory, "component-rules-catalogue.md");
const data = JSON.parse(readFileSync(inputPath, "utf8"));

const expectedCounts = {
  monsters: 6,
  military_branches: 5,
  giant_military_units: 2,
  military_research_cards: 16,
  monster_mutation_cards: 16
};

const allowedClassifications = new Set([
  "persistent",
  "immediate",
  "conditional",
  "one-use/discard"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function validateSource(item, label) {
  assert(item.source?.local_image, `${label} has no local source image`);
  assert(item.source?.web?.startsWith("https://"), `${label} has no web source URL`);
  assert(
    existsSync(join(catalogueDirectory, item.source.local_image)),
    `${label} local source does not exist: ${item.source.local_image}`
  );
  assert(Array.isArray(item.uncertainty), `${label} has no uncertainty array`);
}

for (const [key, count] of Object.entries(expectedCounts)) {
  assert(Array.isArray(data[key]), `${key} is not an array`);
  assert(data[key].length === count, `${key} has ${data[key].length} entries; expected ${count}`);
  const names = data[key].map((item) => item.name);
  assert(new Set(names).size === names.length, `${key} contains duplicate names`);
}

for (const monster of data.monsters) validateSource(monster, `Monster ${monster.name}`);
for (const branch of data.military_branches) {
  validateSource(branch, `Military branch ${branch.name}`);
  assert(branch.units.length > 0, `${branch.name} has no units`);
}
for (const unit of data.giant_military_units) validateSource(unit, `Giant unit ${unit.name}`);
for (const deckName of ["military_research_cards", "monster_mutation_cards"]) {
  for (const card of data[deckName]) {
    validateSource(card, `Card ${card.name}`);
    assert(card.transcription, `Card ${card.name} has no transcription`);
    assert(card.timing, `Card ${card.name} has no timing`);
    assert(card.duration, `Card ${card.name} has no duration`);
    assert(card.classification.length > 0, `Card ${card.name} has no classification`);
    for (const classification of card.classification) {
      assert(allowedClassifications.has(classification), `${card.name} has invalid classification ${classification}`);
    }
  }
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function source(sourceValue) {
  return `[local image](${sourceValue.local_image}) · [BGG source](${sourceValue.web})`;
}

function uncertainty(item) {
  return item.uncertainty.length === 0 ? "None" : item.uncertainty.join("; ");
}

function move(moveValue) {
  if ("normal" in moveValue) {
    const normal = `${moveValue.normal.value} (${moveValue.normal.modes.join("/")})`;
    const launched = `${moveValue.launched.value} (${moveValue.launched.modes.join("/")})`;
    return `${normal}; launched ${launched}`;
  }
  const modes = moveValue.modes.length ? ` (${moveValue.modes.join("/")})` : "";
  return `${moveValue.value}${modes}`;
}

function cardTable(cards) {
  const lines = [
    "| Card | Exact transcription | Classification | Timing and duration | Source | Uncertainty |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const card of cards) {
    lines.push(
      `| ${cell(card.name)} | ${cell(card.transcription)} | ${cell(card.classification.join(", "))} | ${cell(`${card.timing} Duration: ${card.duration}`)} | ${source(card.source)} | ${cell(uncertainty(card))} |`
    );
  }
  return lines;
}

const lines = [
  "# Monsters Menace America component-rules catalogue",
  "",
  "Source-backed catalogue for internal rules analysis. The component images and their artwork remain copyrighted third-party reference material and are not cleared for product distribution.",
  "",
  `Machine-readable source: [${relative(catalogueDirectory, inputPath)}](${relative(catalogueDirectory, inputPath)})`,
  "",
  "## Method",
  "",
  "The transcription column preserves the rule wording and punctuation visible in its cited image. Whitespace is normalized except where a line break separates printed effects. Timing, duration, classifications, and structured numeric fields are interpretations and are kept separate from literal transcription. `None` in an uncertainty cell means the rule-bearing text recorded in that row is legible in the cited source; it does not assert that the component settles every possible rules interaction.",
  "",
  "Card classifications:",
  "",
  ...Object.entries(data.classification_definitions).map(([name, description]) => `- **${name}:** ${description}`),
  "",
  "## Monsters",
  "",
  "| Monster | Starting Health | Move | Defense | Attacks | Damage | Exact special ability | Source | Uncertainty |",
  "| --- | ---: | --- | ---: | ---: | ---: | --- | --- | --- |",
  ...data.monsters.map((monster) =>
    `| ${monster.name} | ${monster.starting_health} | ${move(monster.move)} | ${monster.defense} | ${monster.attacks} | ${monster.damage} | ${cell(monster.special_ability_transcription)} | ${source(monster.source)} | ${uncertainty(monster)} |`
  ),
  "",
  "## Military branches",
  ""
];

for (const branch of data.military_branches) {
  const branchRule = branch.deployment_transcription ?? branch.placement_transcription;
  lines.push(
    `### ${branch.name}`,
    "",
    `**Exact deployment/placement rule:** ${branchRule} (${source(branch.source)})`,
    "",
    "| Unit | Count | Move | Defense | Damage | Exact special rule | Source | Uncertainty |",
    "| --- | ---: | --- | ---: | ---: | --- | --- | --- |"
  );
  for (const unit of branch.units) {
    lines.push(
      `| ${unit.name} | ${unit.count} | ${move(unit.move)} | ${cell(typeof unit.defense === "object" ? `normal ${unit.defense.normal}; launched ${unit.defense.launched}` : unit.defense)} | ${cell(typeof unit.damage === "object" ? `normal ${unit.damage.normal}; launched ${unit.damage.launched}` : unit.damage)} | ${cell(unit.special_rule_transcription)} | ${source(branch.source)} | ${uncertainty(branch)} |`
    );
  }
  lines.push("");
}

lines.push(
  "## Giant military units",
  "",
  "| Unit | Health | Move | Defense | Attacks | Damage | Source | Uncertainty |",
  "| --- | ---: | --- | ---: | ---: | ---: | --- | --- |",
  ...data.giant_military_units.map((unit) =>
    `| ${unit.name} | ${unit.health} | ${move(unit.move)} | ${unit.defense} | ${unit.attacks} | ${unit.damage} | ${source(unit.source)} | ${uncertainty(unit)} |`
  ),
  "",
  "## Military Research cards",
  "",
  ...cardTable(data.military_research_cards),
  "",
  "## Monster Mutation cards",
  "",
  ...cardTable(data.monster_mutation_cards),
  "",
  "## Completeness summary",
  "",
  `- ${data.monsters.length}/6 monster records.`,
  `- ${data.military_branches.length}/5 military-branch records.`,
  `- ${data.giant_military_units.length}/2 giant military-unit records.`,
  `- ${data.military_research_cards.length}/16 uniquely named Military Research cards.`,
  `- ${data.monster_mutation_cards.length}/16 uniquely named Monster Mutation cards.`,
  `- ${[...data.monsters, ...data.military_branches, ...data.giant_military_units, ...data.military_research_cards, ...data.monster_mutation_cards].filter((item) => item.uncertainty.length > 0).length} records currently carry explicit transcription uncertainty.`,
  ""
);

writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Validated catalogue and wrote ${relative(root, outputPath)}`);
