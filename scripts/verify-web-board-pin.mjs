import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pinSource = await readFile(resolve(root, "apps/web/src/board-pin.ts"), "utf8");
const gridSource = await readFile(resolve(root, "apps/web/src/components/HexGrid.tsx"), "utf8");
const phaseActionsSource = await readFile(resolve(root, "apps/web/src/components/PhaseActions.tsx"), "utf8");
const boardLayoutSource = await readFile(resolve(root, "apps/web/src/board-layout.ts"), "utf8");
const engineSource = await readFile(resolve(root, "packages/game-engine/src/index.ts"), "utf8");
const mainSource = await readFile(resolve(root, "apps/web/src/main.tsx"), "utf8") + await readFile(resolve(root, "apps/web/src/components/BoardViewport.tsx"), "utf8");
const stylesheetSource = await readFile(resolve(root, "apps/web/src/styles.css"), "utf8");
const required = [
  ["audited board ID, version, and hash match", /game\.boardId === AUDITED_BOARD\.id && game\.boardVersion === AUDITED_BOARD\.version && game\.boardContentHash === AUDITED_BOARD\.contentHash/],
  ["shared board resolver", /export function boardForGame/],
  ["full-board ID, version, and hash match", /game\.boardId === FULL_HONEYCOMB_BOARD\.id && game\.boardVersion === FULL_HONEYCOMB_BOARD\.version && game\.boardContentHash === FULL_HONEYCOMB_BOARD\.contentHash/],
  ["development-board ID, version, and hash match", /game\.boardId === DEVELOPMENT_BOARD\.id && game\.boardVersion === DEVELOPMENT_BOARD\.version && game\.boardContentHash === DEVELOPMENT_BOARD\.contentHash/],
  ["unknown pin is unavailable", /return undefined/],
  ["grid uses shared resolver", /import \{ boardForGame \} from "\.\.\/board-pin"/],
  ["grid does not fall back to development topology", /const boardIndex = useMemo\(\(\) => board \? buildBoardIndex\(board\) : undefined, \[board\]\);/],
  ["pinned authored boards do not inherit development locations", /if \(board\.id === AUDITED_BOARD\.id \|\| board\.id === FULL_HONEYCOMB_BOARD\.id \|\| board\.id === PROVISIONAL_AUTHORITATIVE_BOARD\.id\) \{\s*return buildDisplayHexLayout\(board\)\.map\(\(\{ hex, left, top \}\) => \(\{ hex, left, top, developmentFixture: false \}\)\);/],
  ["phase actions use shared resolver", /import \{ boardForGame \} from "\.\.\/board-pin"/],
  ["Laser Fence retreat uses the match-pinned board neighbors", /export function legalLaserFenceTargets\(state: GameState\)[\s\S]*const boardIndex = buildBoardIndex\(boardForState\(state\)\);[\s\S]*boardIndex\.neighbours\[monster\.location\]/],
  ["unresolved shell has no visible placeholder label", /const provisionalFeatureName = \(audited \|\| board\?\.id === PROVISIONAL_AUTHORITATIVE_BOARD\.id\)[\s\S]*const visibleName = setupLocations\?\.get\(placeKey\) \?\? place\?\.name \?\? \(developmentFixture \? hex\.label : provisionalFeatureName \?\? ""\);/],
  ["unresolved shell has no placeholder marker", /\{place && <span className="node"/],
  ["unresolved shell has no implied terrain artwork", /const baseArt = hex\.waterClass === "unresolved"\s*\? undefined/],
  ["unresolved shell has neutral hatch treatment", /\.hex-tile\.unresolved\{background:repeating-linear-gradient/],
  ["grid hides unknown topology", /className="board-unavailable" role="alert"/],
  ["map metadata uses resolved board", /data-rendered-board-id=\{board\?\.id \?\? "unavailable"\}/],
  ["map metadata uses resolved hash", /data-rendered-board-content-hash=\{board\?\.contentHash \?\? "unavailable"\}/],
];
const source = `${pinSource}\n${gridSource}\n${phaseActionsSource}\n${engineSource}\n${mainSource}\n${boardLayoutSource}\n${stylesheetSource}`;
const failures = required.filter(([, marker]) => !marker.test(source)).map(([label]) => label);
if (failures.length > 0) throw new Error(`Web board-pin contract failed: ${failures.join(", ")}`);
console.log("Verified exact board ID/hash pin resolution and fail-closed web rendering contract.");
