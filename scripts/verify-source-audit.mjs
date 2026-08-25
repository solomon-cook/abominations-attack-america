import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const catalogue = JSON.parse(readFileSync(join(root, "references/monsters-menace-america/component-rules-catalogue.json"), "utf8"));
const inventory = readFileSync(join(root, "docs/component-inventory.md"), "utf8");
const unresolved = readFileSync(join(root, "docs/unresolved-rules-inventory.md"), "utf8");

const expected = { monsters: 6, military_branches: 5, giant_military_units: 2, military_research_cards: 16, monster_mutation_cards: 16 };
for (const [key, count] of Object.entries(expected)) {
  if (!Array.isArray(catalogue[key]) || catalogue[key].length !== count) throw new Error(`${key} catalogue count is not ${count}`);
}
const requiredMonsterFields = ["starting_health", "move", "defense", "attacks", "damage", "special_ability_transcription"];
for (const monster of catalogue.monsters) {
  for (const field of requiredMonsterFields) if (monster[field] === undefined || monster[field] === null) throw new Error(`Monster ${monster.name} is missing ${field}`);
  if (!Number.isInteger(monster.starting_health) || monster.starting_health <= 0) throw new Error(`Monster ${monster.name} has invalid starting health`);
  if (!Number.isInteger(monster.attacks) || monster.attacks <= 0) throw new Error(`Monster ${monster.name} has invalid attack count`);
  if (!monster.source?.local_image || !monster.source?.web) throw new Error(`Monster ${monster.name} has incomplete source references`);
}
for (const branch of catalogue.military_branches) {
  if (!branch.deployment_transcription && !branch.placement_transcription) throw new Error(`Military branch ${branch.name} has no deployment transcription`);
  if (!Array.isArray(branch.units) || branch.units.length === 0) throw new Error(`Military branch ${branch.name} has no unit records`);
  for (const unit of branch.units) {
    for (const field of ["count", "move", "defense", "damage"]) if (unit[field] === undefined || unit[field] === null) throw new Error(`${branch.name} ${unit.name} is missing ${field}`);
    if (!Number.isInteger(unit.count) || unit.count <= 0) throw new Error(`${branch.name} ${unit.name} has invalid quantity`);
  }
}
for (const unit of catalogue.giant_military_units) {
  for (const field of ["health", "move", "defense", "attacks", "damage"]) if (unit[field] === undefined || unit[field] === null) throw new Error(`Giant unit ${unit.name} is missing ${field}`);
}
for (const phrase of ["| Infamy tokens | 42 |", "| Stomp markers | 23 |", "| Six-sided dice | 3 |", "| Plastic Health/record sliders | 15 |", "Black X-Fighters", "| Board | 1 |"]) {
  if (!inventory.includes(phrase)) throw new Error(`Component inventory is missing: ${phrase}`);
}
for (const id of ["BOARD-GEOMETRY", "MONSTER-STATS", "UNIT-STATS", "BRANCH-DEPLOYMENT", "CARD-EFFECTS", "NATIONAL-GUARD-CONTROL", "GIANT-PLACEMENT", "SPECIAL-CASES"]) {
  if (!unresolved.includes(`| ${id} |`)) throw new Error(`Unresolved inventory is missing: ${id}`);
}
console.log("Verified component counts and eight explicit unresolved rule inputs.");
