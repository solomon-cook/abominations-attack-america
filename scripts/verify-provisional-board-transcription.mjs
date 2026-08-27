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

const rows = cellLedger.split("\n").filter((line) => /^\| `[^`]+` \|/.test(line));
const field = (line, index) => line.split("|")[index + 1]?.trim() ?? "";
const visualStates = rows.map((line) => field(line, 2));
const features = rows.map((line) => field(line, 3));
const countExact = (values, value) => values.filter((candidate) => candidate === value).length;
const countPrefix = (values, prefix) => values.filter((candidate) => candidate.startsWith(prefix)).length;
if (countExact(visualStates, "candidate-sea") !== 99) throw new Error("Ledger sea-cell count drifted from the photo-aligned candidate mask.");
if (countExact(visualStates, "candidate-lake") !== 8) throw new Error("Ledger lake-cell count drifted from the photo-aligned candidate mask.");
if (countExact(visualStates, "candidate-seacoast") !== 49) throw new Error("Ledger seacoast-cell count drifted from the photo-aligned candidate mask.");
if (countPrefix(features, "city (") !== 45) throw new Error("Ledger city-feature count drifted from the provisional board.");
const baseFeatureCount = features.reduce((total, value) => total + (value.match(/military-base \([^)]*\)/g) ?? []).length, 0);
if (baseFeatureCount !== 35) throw new Error(`Ledger military-base feature count drifted from the provisional board: ${baseFeatureCount}`);
if (countPrefix(features, "infamy-site") !== 15) throw new Error("Ledger Infamy-site count drifted from the provisional board.");
if (countPrefix(features, "mutation-site (") !== 4) throw new Error("Ledger Mutation-site count drifted from the provisional board.");
if (countPrefix(features, "lair (") !== 6) throw new Error("Ledger lair count drifted from the provisional board.");
const tulsa = rows.find((line) => line.includes("| 8 / 12 |"));
const nashville = rows.find((line) => line.includes("| 8 / 16 |"));
if (!tulsa?.includes("city (Roll 1 die)")) throw new Error("Ledger must retain Tulsa at 8/12.");
if (!nashville?.includes("city (+1 Health), military-base (Army)")) throw new Error("Ledger must retain Nashville plus Army co-location at 8/16.");
const sharedInfamyBase = rows.find((line) => line.includes("| 10 / 19 |"));
if (!sharedInfamyBase?.includes("infamy-site, military-base (Navy)")) throw new Error("Ledger must retain the shared Infamy/Navy-base face at 10/19.");
const sharedBases = rows.find((line) => line.includes("| 6 / 21 |"));
if (!sharedBases?.includes("military-base (Air Force), military-base (Navy)")) throw new Error("Ledger must retain both Air Force and Navy bases at 6/21.");
for (const rowColumn of ["7 / 4", "9 / 6", "10 / 11"]) {
  const infamyBase = rows.find((line) => line.includes(`| ${rowColumn} |`));
  if (!infamyBase?.includes("infamy-site, military-base (Air Force)")) throw new Error(`Ledger must retain the shared Infamy/Air Force face at ${rowColumn}.`);
}
const coLocationSection = ledger.slice(ledger.indexOf("## Provisional city/base co-location inventory"), ledger.indexOf("## Bonus-first city inference"));
if ((coLocationSection.match(/^\| (?:Boston|Baltimore|Richmond|Nashville|Birmingham|Austin|Kansas City) \|/gm) ?? []).length !== 7) {
  throw new Error("Ledger must retain all seven currently mapped city/base co-locations.");
}

if (boardSource.includes("provisional-board-transcription")) {
  throw new Error("Production board source must not import the provisional transcription ledger.");
}

console.log("Verified provisional board ledger coverage: 336 unique cells, explicit disclaimer, and no production import.");
