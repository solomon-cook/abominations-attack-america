import { readFile, writeFile } from "node:fs/promises";
import { CARD_DEFINITIONS, SOURCED_CARD_RULES, sourcedCardRule } from "../packages/game-engine/src/cards.js";

type CardManifest = {
  readonly individualArtworkSources?: Record<string, unknown>;
  readonly artworkReview?: { readonly status?: unknown; readonly reviewer?: unknown; readonly reviewedOn?: unknown };
  readonly cards?: readonly {
    readonly id?: unknown;
    readonly deck?: unknown;
    readonly src?: unknown;
    readonly textStatus?: unknown;
  }[];
};

const manifestPath = new URL("../apps/web/public/assets/cards/manifest.json", import.meta.url);
const matrixPath = new URL("../docs/card-art-review-matrix.md", import.meta.url);

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function buildMatrix(manifest: CardManifest): string {
  const cards = manifest.cards;
  const sourceRoots = manifest.individualArtworkSources;
  const artworkReview = manifest.artworkReview;
  if (!cards || cards.length !== 32) throw new Error("Card artwork review matrix requires exactly 32 manifest cards.");
  if (!sourceRoots || typeof sourceRoots["Military Research"] !== "string" || typeof sourceRoots["Monster Mutation"] !== "string") {
    throw new Error("Card artwork review matrix requires separate source roots for both decks.");
  }
  if (artworkReview?.status !== "approved" || typeof artworkReview.reviewer !== "string" || typeof artworkReview.reviewedOn !== "string") {
    throw new Error("Card artwork review matrix requires explicit project-owner artwork approval metadata.");
  }
  if (SOURCED_CARD_RULES.length !== CARD_DEFINITIONS.length || CARD_DEFINITIONS.length !== cards.length) {
    throw new Error("Card artwork review matrix source coverage does not match the 32-card catalogue.");
  }

  const seen = new Set<string>();
  const rows = cards.map((card) => {
    if (typeof card.id !== "string" || seen.has(card.id)) throw new Error(`Card artwork review matrix has an invalid or duplicate card ID: ${String(card.id)}`);
    if (card.deck !== "Military Research" && card.deck !== "Monster Mutation") throw new Error(`Card artwork review matrix has an invalid deck for ${card.id}.`);
    if (typeof card.src !== "string" || !card.src.startsWith("/assets/cards/") || !card.src.endsWith(".webp")) throw new Error(`Card artwork review matrix has an invalid artwork path for ${card.id}.`);
    if (card.textStatus !== "candidate-authoritative-text") throw new Error(`Card artwork must remain candidate-authoritative-text: ${card.id}`);
    const rule = sourcedCardRule(card.id);
    if (!rule || !rule.transcription.trim()) throw new Error(`Card ${card.id} is missing an exact sourced transcription.`);
    seen.add(card.id);
    const sourceRoot = sourceRoots[card.deck];
    if (typeof sourceRoot !== "string" || !sourceRoot.endsWith("/")) throw new Error(`Card ${card.id} is missing its separate source root.`);
    return `| ${cell(card.deck)} | ${cell(card.id)} | \`${cell(card.src)}\` | \`${cell(sourceRoot)}\` | ${cell(card.textStatus)} | available | approved (${cell(artworkReview.reviewedOn)}) | ${cell(artworkReview.reviewer)} | approved |`;
  });

  const manifestIds = new Set(cards.map((card) => card.id));
  if (manifestIds.size !== 32 || SOURCED_CARD_RULES.some((rule) => !manifestIds.has(rule.id))) throw new Error("Card artwork review matrix does not cover every sourced card rule.");
  return [
    "# Card artwork review matrix",
    "",
    "This deterministic matrix is generated from `apps/web/public/assets/cards/manifest.json` and `packages/game-engine/src/cards.ts`. It is a bounded review register, not visual approval or production promotion.",
    "",
    `The project-owner artwork review is approved by ${artworkReview.reviewer} on ${artworkReview.reviewedOn}. \`Text status\` remains the manifest's source/text provenance status; \`SOURCED_CARD_RULES\` remains authoritative for wording and effects.`,
    "",
    "| Deck | Card ID | Artwork path | Separate source root | Text status | Exact transcription availability | Visual review status | Reviewer | Approval status |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as CardManifest;
  const output = buildMatrix(manifest);
  if (process.argv.includes("--check")) {
    const current = await readFile(matrixPath, "utf8").catch(() => "");
    if (current !== output) throw new Error("Card artwork review matrix is stale; run the generator to update it.");
    console.log("Card artwork review matrix is deterministic and current (32 rows).");
    return;
  }
  await writeFile(matrixPath, output);
  console.log("Generated docs/card-art-review-matrix.md with 32 rows.");
}

void main();
