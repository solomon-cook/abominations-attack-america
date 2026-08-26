import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pinSource = await readFile(resolve(root, "apps/web/src/board-pin.ts"), "utf8");
const gridSource = await readFile(resolve(root, "apps/web/src/components/HexGrid.tsx"), "utf8");
const phaseActionsSource = await readFile(resolve(root, "apps/web/src/components/PhaseActions.tsx"), "utf8");
const mainSource = await readFile(resolve(root, "apps/web/src/main.tsx"), "utf8");
const stylesheetSource = await readFile(resolve(root, "apps/web/src/styles.css"), "utf8");
const required = [
  ["shared board resolver", /export function boardForGame/],
  ["full-board ID, version, and hash match", /game\.boardId === FULL_HONEYCOMB_BOARD\.id && game\.boardVersion === FULL_HONEYCOMB_BOARD\.version && game\.boardContentHash === FULL_HONEYCOMB_BOARD\.contentHash/],
  ["development-board ID, version, and hash match", /game\.boardId === DEVELOPMENT_BOARD\.id && game\.boardVersion === DEVELOPMENT_BOARD\.version && game\.boardContentHash === DEVELOPMENT_BOARD\.contentHash/],
  ["unknown pin is unavailable", /return undefined/],
  ["grid uses shared resolver", /import \{ boardForGame \} from "\.\.\/board-pin"/],
  ["grid does not fall back to development topology", /const boardIndex = board \? buildBoardIndex\(board\) : undefined;/],
  ["full shell does not inherit development locations", /place: undefined,[\s\S]*developmentFixture: false/],
  ["phase actions use shared resolver", /import \{ boardForGame \} from "\.\.\/board-pin"/],
  ["Laser Fence uses resolved board edges", /const activeBoard = boardForGame\(activeGame\);[\s\S]*activeBoard\.edges/],
  ["unresolved shell has no visible placeholder label", /const visibleName = place\?\.name \?\? \(developmentFixture \? hex\.label : provisionalFeatureName \?\? ""\);/],
  ["unresolved shell has no placeholder marker", /\{place && <span className="node"/],
  ["unresolved shell has no implied terrain artwork", /const baseArt = hex\.waterClass === "unresolved"\s*\? undefined/],
  ["unresolved shell has neutral hatch treatment", /\.hex-tile\.unresolved\{background:repeating-linear-gradient/],
  ["grid hides unknown topology", /className="board-unavailable" role="alert"/],
  ["map metadata uses resolved board", /data-rendered-board-id=\{renderedBoard\?\.id \?\? "unavailable"\}/],
  ["map metadata uses resolved hash", /data-rendered-board-content-hash=\{renderedBoard\?\.contentHash \?\? "unavailable"\}/],
];
const source = `${pinSource}\n${gridSource}\n${phaseActionsSource}\n${mainSource}\n${stylesheetSource}`;
const failures = required.filter(([, marker]) => !marker.test(source)).map(([label]) => label);
if (failures.length > 0) throw new Error(`Web board-pin contract failed: ${failures.join(", ")}`);
console.log("Verified exact board ID/hash pin resolution and fail-closed web rendering contract.");
