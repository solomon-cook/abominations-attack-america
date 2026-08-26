import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const assetRoot = resolve(scriptDirectory, "../apps/web/public/assets/board");
const cardAssetRoot = resolve(scriptDirectory, "../apps/web/public/assets/cards");
const monsterAssetRoot = resolve(scriptDirectory, "../apps/web/public/assets/monsters");
const diceAssetRoot = resolve(scriptDirectory, "../apps/web/public/assets/dice");
let optimizedPairs = 0;
let sourceBytes = 0;
let optimizedBytes = 0;

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function assertFile(path, label) {
  try {
    await readFile(path);
  } catch {
    throw new Error(`${label} is missing: ${relative(assetRoot, path)}`);
  }
}

async function assertMissing(path, label) {
  try {
    await readFile(path);
  } catch {
    return;
  }
  throw new Error(`${label} must not be shipped: ${relative(assetRoot, path)}`);
}

async function checkManifest(directory, manifestName = "manifest.json") {
  const manifestPath = join(directory, manifestName);
  const manifest = await readJson(manifestPath);
  const files = [];

  function collect(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.file === "string") files.push(value.file);
    for (const child of Object.values(value)) collect(child);
  }

  collect(manifest);
  if (files.length === 0) throw new Error(`${relative(assetRoot, manifestPath)} declares no files`);

  for (const sourceFile of files) {
    const sourcePath = join(directory, sourceFile);
    await assertFile(sourcePath, "Source asset");
    const extension = sourceFile.toLowerCase().endsWith(".png") ? ".webp" : null;
    if (extension && manifest.preferredExtension === extension) {
      const optimizedPath = sourcePath.slice(0, -4) + extension;
      await assertFile(optimizedPath, "Optimized asset");
      const [sourceStats, optimizedStats] = await Promise.all([stat(sourcePath), stat(optimizedPath)]);
      if (optimizedStats.size >= sourceStats.size) {
        throw new Error(`Optimized asset is not smaller than its source: ${relative(assetRoot, optimizedPath)} (${optimizedStats.size} >= ${sourceStats.size} bytes)`);
      }
      optimizedPairs += 1;
      sourceBytes += sourceStats.size;
      optimizedBytes += optimizedStats.size;
    }
  }
}

await checkManifest(join(assetRoot, "coast"));
await checkManifest(join(assetRoot, "coastal-city"));
await checkManifest(join(assetRoot, "features"));
await checkManifest(join(assetRoot, "tokens"));
await assertFile(join(assetRoot, "original-game-hero.webp"), "Original hero artwork");
await assertMissing(join(assetRoot, "full-board-top-down.webp"), "Internal board reference");
await assertMissing(join(assetRoot, "full-game-setup.webp"), "Internal setup reference");

const cardManifest = JSON.parse(await readFile(join(cardAssetRoot, "manifest.json"), "utf8"));
if (cardManifest.format !== "webp" || !Array.isArray(cardManifest.sheets) || cardManifest.sheets.length !== 7) throw new Error("Card asset manifest is incomplete");
for (const sheet of cardManifest.sheets) await assertFile(join(cardAssetRoot, sheet.id + ".webp"), "Optimized card sheet");
await assertFile(join(cardAssetRoot, "README.md"), "Card asset provenance README");

const monsterManifest = JSON.parse(await readFile(join(monsterAssetRoot, "manifest.json"), "utf8"));
if (monsterManifest.format !== "webp" || !Array.isArray(monsterManifest.monsters) || monsterManifest.monsters.length !== 6) throw new Error("Monster asset manifest is incomplete");
for (const monster of monsterManifest.monsters) await assertFile(join(monsterAssetRoot, monster.id + ".webp"), "Optimized monster sprite");
await assertFile(join(monsterAssetRoot, "README.md"), "Monster asset provenance README");

const militaryManifest = JSON.parse(await readFile(join(scriptDirectory, "../apps/web/public/assets/military/manifest.json"), "utf8"));
if (militaryManifest.format !== "webp" || !Array.isArray(militaryManifest.units) || militaryManifest.units.length !== 11) throw new Error("Military asset manifest is incomplete");
const militaryIds = new Set();
for (const unit of militaryManifest.units) {
  if (typeof unit.id !== "string" || militaryIds.has(unit.id)) throw new Error(`Military asset manifest has an invalid or duplicate ID: ${unit.id ?? "missing"}`);
  militaryIds.add(unit.id);
  if (typeof unit.src !== "string" || !unit.src.startsWith("/assets/military/") || !unit.src.endsWith(".webp")) throw new Error(`Military asset manifest has an invalid source for ${unit.id}`);
  await assertFile(join(scriptDirectory, "../apps/web/public/assets", unit.src.slice("/assets/".length)), "Optimized military sprite");
}
await assertFile(join(scriptDirectory, "../apps/web/public/assets/military/README.md"), "Military asset provenance README");

const diceManifest = JSON.parse(await readFile(join(diceAssetRoot, "manifest.json"), "utf8"));
if (diceManifest.format !== "webp" || !Array.isArray(diceManifest.faces) || diceManifest.faces.length !== 6) throw new Error("Dice asset manifest is incomplete");
for (const face of diceManifest.faces) await assertFile(join(diceAssetRoot, face.file), "Optimized die face");
await assertFile(join(diceAssetRoot, "README.md"), "Dice asset provenance README");

const topLevelEntries = await readdir(assetRoot);
if (!topLevelEntries.includes("README.md")) throw new Error("Board asset provenance README is missing");
const savedBytes = sourceBytes - optimizedBytes;
console.log(`Board, card, monster, and cream die-face asset manifests verified (${optimizedPairs} PNG/WebP pairs; ${savedBytes} bytes saved by WebP derivatives).`);
