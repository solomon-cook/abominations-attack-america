import { readFile } from "node:fs/promises";

const ledgerUrl = new URL("../docs/provisional-board-transcription.md", import.meta.url);
const boardSourceUrl = new URL("../packages/game-engine/src/board.ts", import.meta.url);
const boardSource = await readFile(boardSourceUrl, "utf8");
let ledger;
try {
  ledger = await readFile(ledgerUrl, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  if (process.env.REQUIRE_PROVISIONAL_BOARD_LEDGER === "1") {
    throw new Error("The provisional board ledger is required in strict source-review mode.");
  }
  console.warn("Provisional board ledger is not present in this checkout; source-gated board promotion remains blocked. Set REQUIRE_PROVISIONAL_BOARD_LEDGER=1 to require the local review artifact.");
  if (boardSource.includes("provisional-board-transcription")) {
    throw new Error("Production board source must not import the provisional transcription ledger.");
  }
  process.exit(0);
}

if (!ledger.includes("not authoritative game data") || !ledger.includes("must not be imported by the engine")) {
  throw new Error("Provisional board ledger must retain its non-authoritative disclaimer.");
}

const ledgerStart = ledger.indexOf("## Cell ledger");
const ledgerEnd = ledger.indexOf("## Cross-reference workflow", ledgerStart + 1);
if (ledgerStart < 0 || ledgerEnd < 0 || ledgerEnd <= ledgerStart) {
  throw new Error("Provisional board ledger must contain a bounded Cell ledger section.");
}
const cellLedger = ledger.slice(ledgerStart, ledgerEnd);
const keys = [...cellLedger.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);
if (keys.length !== 336 || new Set(keys).size !== 336) {
  throw new Error(`Expected 336 unique coordinate-shell rows, found ${keys.length}.`);
}

if (boardSource.includes("provisional-board-transcription")) {
  throw new Error("Production board source must not import the provisional transcription ledger.");
}

console.log("Verified provisional board ledger coverage: 336 unique cells, explicit disclaimer, and no production import.");
