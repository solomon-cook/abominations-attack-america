import { readFile } from "node:fs/promises";

const [ledger, boardSource] = await Promise.all([
  readFile(new URL("../docs/provisional-board-transcription.md", import.meta.url), "utf8"),
  readFile(new URL("../packages/game-engine/src/board.ts", import.meta.url), "utf8"),
]);

if (!ledger.includes("not authoritative game data") || !ledger.includes("must not be imported by the engine")) {
  throw new Error("Provisional board ledger must retain its non-authoritative disclaimer.");
}

const keys = [...ledger.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
if (keys.length !== 254 || new Set(keys).size !== 254) {
  throw new Error(`Expected 254 unique coordinate-shell rows, found ${keys.length}.`);
}

if (boardSource.includes("provisional-board-transcription")) {
  throw new Error("Production board source must not import the provisional transcription ledger.");
}

console.log("Verified provisional board ledger coverage: 254 unique cells, explicit disclaimer, and no production import.");
