import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const assetRoot = resolve(scriptDirectory, "../apps/web/public/assets/board");
const cardAssetRoot = resolve(scriptDirectory, "../apps/web/public/assets/cards");

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
      await assertFile(sourcePath.slice(0, -4) + extension, "Optimized asset");
    }
  }
}

await checkManifest(join(assetRoot, "coast"));
await checkManifest(join(assetRoot, "coastal-city"));
await checkManifest(join(assetRoot, "features"));
await checkManifest(join(assetRoot, "tokens"));
await assertFile(join(assetRoot, "full-board-top-down.webp"), "Optimized board reference");
await assertFile(join(assetRoot, "full-game-setup.webp"), "Optimized setup reference");

const cardManifest = JSON.parse(await readFile(join(cardAssetRoot, "manifest.json"), "utf8"));
if (cardManifest.format !== "webp" || !Array.isArray(cardManifest.sheets) || cardManifest.sheets.length !== 7) throw new Error("Card asset manifest is incomplete");
for (const sheet of cardManifest.sheets) await assertFile(join(cardAssetRoot, sheet.id + ".webp"), "Optimized card sheet");
await assertFile(join(cardAssetRoot, "README.md"), "Card asset provenance README");

const topLevelEntries = await readdir(assetRoot);
if (!topLevelEntries.includes("README.md")) throw new Error("Board asset provenance README is missing");
console.log("Board asset manifests and optimized WebP companions verified.");
