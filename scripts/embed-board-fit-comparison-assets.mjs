import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const comparisons = [
  {
    svg: "docs/board-fit-comparison.svg",
    images: [
      "references/monsters-menace-america/components/board/full-game-setup.jpg",
      "output/board-art/board-fit-1440x900.png",
    ],
  },
  {
    svg: "docs/board-fit-comparison-perspective-approximate.svg",
    images: [
      "references/monsters-menace-america/components/board/full-board-top-down.jpg",
      "output/board-art/board-fit-1440x900.png",
    ],
  },
];

const refresh = process.argv.includes("--refresh");
for (const comparison of comparisons) {
  let svg = await readFile(resolve(root, comparison.svg), "utf8");
  const tags = [...svg.matchAll(/<image\b[^>]*\bhref="[^"]*"[^>]*\/>/g)];
  if (tags.length !== comparison.images.length) {
    throw new Error(`${comparison.svg} has ${tags.length} image nodes; expected ${comparison.images.length}.`);
  }

  for (const [assetIndex, assetPath] of comparison.images.entries()) {
    const bytes = await readFile(resolve(root, assetPath));
    const mime = assetPath.endsWith(".png") ? "image/png" : "image/jpeg";
    const dataUri = `data:${mime};base64,${bytes.toString("base64")}`;
    const tag = tags[assetIndex][0];
    const href = tag.match(/\bhref="([^"]*)"/)?.[1];
    if (!href) throw new Error(`${comparison.svg} image ${assetIndex + 1} is missing href.`);
    if (!refresh && href !== dataUri) {
      throw new Error(`${comparison.svg} image ${assetIndex + 1} is stale; run npm run board-fit-comparison:refresh.`);
    }
    if (refresh) {
      const nextTag = tag.replace(`href="${href}"`, `href="${dataUri}"`);
      svg = svg.replace(tag, nextTag);
    }
  }

  if (!refresh && /<image\b[^>]*\bhref="(?!data:image\/)/.test(svg)) {
    throw new Error(`${comparison.svg} contains a non-embedded image reference.`);
  }
  if (refresh) await writeFile(resolve(root, comparison.svg), svg);
}

console.log(refresh
  ? "Embedded the current physical-board and audited-fit assets in both comparison SVGs."
  : "Both board-fit comparison SVGs embed their current physical-board and audited-fit images.");
