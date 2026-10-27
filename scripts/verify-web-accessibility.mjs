import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const componentFiles = (await readdir(resolve(root, "apps/web/src/components")))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => resolve(root, "apps/web/src/components", file));
const source = [
  await readFile(resolve(root, "apps/web/src/main.tsx"), "utf8"),
  await readFile(resolve(root, "apps/web/src/board-camera.ts"), "utf8"),
  ...(await Promise.all(componentFiles.map((file) => readFile(file, "utf8")))),
].join("\n");
const styles = (await Promise.all(["styles.css", "dice.css", "combat-stage.css", "fullscreen-shell.css", "civ-hud.css", "command-panels.css", "encounter-command.css", "physical-sheets.css", "board-terrain.css"].map(file => readFile(resolve(root, "apps/web/src", file), "utf8")))).join("\n");
const boardMarkerText = await Promise.all([
  ["city-health.svg", 26], ["city-1d.svg", 26], ["city-2d.svg", 26], ["city-3d.svg", 26],
  ["infamy-site.svg", 26], ["mutation-site.svg", 26], ["challenge-site.svg", 17],
  ["lair-gargantis.svg", 18], ["lair-konk.svg", 18], ["lair-megaclaw.svg", 18],
  ["lair-tomanagi.svg", 18], ["lair-toxicor.svg", 18], ["lair-zorb.svg", 18],
].map(async ([file, minimum]) => ({ file, minimum, source: await readFile(resolve(root, "apps/web/public/assets/board/overlays", file), "utf8") })));
const failures = [];
for (const { file, minimum, source: svg } of boardMarkerText) {
  const textSizes = [...svg.matchAll(/<text\b[^>]*font-size="([\d.]+)"[^>]*>[^<]+<\/text>/g)].map((match) => Number(match[1]));
  if (!textSizes.some((size) => size >= minimum)) failures.push(`board marker label is below its fit-zoom size floor: ${file}`);
}

const requiredSourceMarkers = [
  ["main landmark", /<main\b/],
  ["unsupported browser guard", /if \(!browserSupported\) \{/],
  ["unsupported browser fallback", /className="unsupported-browser" role="main"[\s\S]*This browser cannot run the playtest[\s\S]*No match state has been started/],
  ["named map group", /aria-label=\"Board coordinate shell\"/],
  ["resolved board description requires verified cells", /const fullBoardVerified = \(renderedBoard\?\.id === AUDITED_BOARD\.id[\s\S]*every\(\(hex\) => hex\.verification === "verified"\)/],
  ["audited board status is distinct from development rules", /const auditedBoard = fullBoardVerified[\s\S]*ruleset status[\s\S]*HUMAN-AUDITED NORTH AMERICA BOARD[\s\S]*Full monster, combat, card, National Guard, and Monster Challenge rules are still in development/],
  ["audited board is identified in the map heading and accessible description", /complete 336-cell human-audited North America board is active[\s\S]*HUMAN-AUDITED TACTICAL MAP/],
  ["unresolved full shell disclosure", /full honeycomb coordinate shell is unresolved review tooling and is not a playable board/],
  ["development board disclosure", /unresolved coordinate shell is not rendered as playable topology/],
  ["hex accessible names", /aria-label=\{`[\s\S]*\$\{displayName\}[\s\S]*hex \$\{hex\.key\}/],
  ["live match status", /aria-live=\"polite\" aria-label=\"Match status\"/],
  ["persistent active player and phase status", /ACTIVE PLAYER[\s\S]*PHASE[\s\S]*CHALLENGE/],
  ["alert errors", /className=\"error\" role=\"alert\"/],
  ["unknown board pins fail closed", /className=\"board-unavailable\" role=\"alert\"/],
  ["keyboard-native controls", /<button[\s\S]*onClick=/],
  ["decorative map stays separate from authoritative canvas", /className=\"map-canvas\"/],
  ["monster artwork", /\/assets\/monsters\/portraits\/\$\{monsterAssetSlug\(/],
  ["Infamy token artwork", /\/assets\/board\/tokens\/infamy_token\.webp/],
  ["revealed card artwork", /cardArtworkSrc\(cardId, kind\)/],
  ["city benefit labels", /printed city benefit/],
  ["Mutation labels", />MUTATION<\//],
  ["pointer-drag board controls", /onPointerMove=\{moveDrag\}/],
  ["wheel board zoom", /map\.addEventListener\("wheel", wheel, \{ passive: false \}\)/],
  ["bounded map zoom", /export function clampCamera/],
  ["bounded map pan", /export function panCamera/],
  ["hover path preview", /onMouseEnter=\{\(event\) => \{ if\(monsterLegal \|\| unitLegal\) onPreviewPath\(placeKey\)/],
  ["readable die face", /<svg className="die-face"[\s\S]*pips\[value\]/],
  ["authoritative die result label", /aria-label=\{label\}/],
  ["recorded encounter result", /aria-label="Recorded encounter result"/],
  ["accepted action feedback", /<ActionResolutionFeedback label=\{acceptedActionFeedback\?\.label\}/],
  ["authoritative action readiness announcement", /id="action-dock-status" className="action-dock-status" aria-live="polite"/],
  ["encounter authoritative dice", /aria-label="Recorded encounter dice rolls"/],
  ["Mutation draw status", /aria-label="Mutation site draw status"[\s\S]*Mutation card drawn; card effect remains source-gated/],
  ["Hollywood recovery die", /aria-label="Recorded Hollywood recovery die"/],
  ["Monster Challenge duel surface", /aria-label="Recorded Monster Challenge duel"/],
  ["full-screen Monster Challenge return", /<ChallengeArena[\s\S]*onClose=\{\(\) => setChallengeDuelOpen\(false\)\}/],
  ["full-screen Monster Challenge focus entry", /<button autoFocus className="resolution-close"[\s\S]*aria-label="Return to board"/],
  ["authoritative Challenge Health replay", /targetHealthBefore/],
  ["visible combat outcomes", /className=\"combat-outcomes\"[\s\S]*lastFightOutcomes/],
  ["normal fight resolution surface", /ResolutionStage variant="fight"[\s\S]*className="battle-forces" aria-label=\{`Military targets/],
  ["contextual decision rules help", /className="decision-rules-help"><summary>Rules for this step/],
  ["development fixture overlay", /development-fixture/],
  ["canonical adjacency styling", /activeNeighbours\.has\(placeKey\)/],
  ["contextual board feature and edge details", /boardHexFeatureLabel\(hex\)[\s\S]*Recorded edge barriers/],
  ["board inspection tray remains outside the collapsible controls panel", /<header>[\s\S]*<BoardContextTray[^>]*className="board-context-tray-focus"/],
  ["full accessible board feature descriptions", /const featureText = boardHexFeatureLabel\(hex\)[\s\S]*aria-label=\{`[\s\S]*\$\{featureText\}[\s\S]*data-feature-description=\{featureText\}/],
  ["audited coordinate accessible detail", /const auditCellText = hex\.audit \? `physical cell \$\{hex\.audit\.row\}, \$\{hex\.audit\.column\}`[\s\S]*\$\{auditCellText \? `, \$\{auditCellText\}`/],
  ["selected piece contextual tray", /className="piece-detail-tray monster-command-record" aria-label="Selected piece details"/],
  ["hex hover and focus explanations", /title=\{tooltipText\}/],
  ["consistent metric icon treatment", /className="metric-icon"[\s\S]*aria-hidden="true"/],
  ["viewport-fitted gameplay shell", /className=\{`game-screen/],
  ["on-demand game details toggle", /aria-controls="turn-hud-body" aria-label=\{gamePanelOpen/],
  ["named game controls panel", /id="game-side-panel" className="game-side-panel" aria-label="Game controls and information"/],
  ["player card-action details", /aria-label=\{`Card actions for Player/],
  ["apostrophe-safe card artwork slugs", /replaceAll\("'", ""\)/],
  ["card rule metadata", /aria-label=\{`\$\{cardId\} rule metadata`/],
  ["card source and target boundaries", /Target and confirmation:[\s\S]*Source:/],
  ["implemented card action windows", /Optional Mutation battle abilities[\s\S]*Defense Satellites[\s\S]*Antimatter[\s\S]*Laser Fence[\s\S]*Stabilizer Ray/],
  ["direct hand card actions", /className="hand-card-play"[\s\S]*type: "use-(mutation|research)"/],
  ["authoritative card commands", /runCommand\(\{ type: "use-(mutation|research)"/],
  ["encounter resolution action", /activeGame\.pendingDecision\?\.type === "encounter-resolution"[\s\S]*Resolve encounter/],
  ["audio feedback categories", /playSound\(category/],
  ["persisted audio settings", /type="range" min="0" max="1"/],
  ["named local board theme selector", /aria-label="Board theme"[\s\S]*option value="classic"[\s\S]*option value="moonlit"[\s\S]*option value="desert"/],
];
for (const [label, marker] of requiredSourceMarkers) if (!marker.test(source)) failures.push(`missing ${label}`);
if (/className="map-copy"|className="region-label/.test(source)) {
  failures.push("gameplay map contains decorative title or region overlays that can cross authored tile seams");
}

const requiredStyleMarkers = [
  ["visible focus treatment", /:focus-visible/],
  ["reduced motion", /prefers-reduced-motion:reduce/],
  ["manual reduced motion", /manual-reduced-motion/],
  ["touch-sized map controls", /\.map-controls button\{[^}]*min-width:44px[^}]*min-height:44px/],
  ["no horizontal overflow", /overflow-x:clip/],
  ["generated decorative map backdrop", /\.map::after\{/],
  ["touch-drag board viewport", /\.map\{touch-action:none/],
  ["settling die animation", /@keyframes die-settle/],
  ["reduced-motion dice", /@media\(prefers-reduced-motion:reduce\)\{\.combat-die\[data-die\] \.die-face\{animation:none\}/],
  ["encounter result surface", /\.encounter-result\{/],
  ["accepted action motion", /\.action-resolution-feedback\{/],
  ["attention banner layout", /\.attention-banner\{/],
  ["adjacent hex treatment", /\.hex-tile\.adjacent\{/],
  ["focused hex prominence", /\.hex-tile:focus-visible\{z-index:8\}/],
  ["uncropped authored artwork", /\.hex-tile \.tile-art\{object-fit:contain;object-position:center\}/],
  ["uncropped revealed cards", /\.revealed-card-art\{object-fit:contain;object-position:center;background:/],
  ["viewport-fitted gameplay layout", /\.game-screen\{height:100dvh;max-height:100dvh/],
  ["board-first closed layout", /\.game-screen \.layout\.panel-closed\{grid-template-columns:minmax\(0,1fr\)/],
  ["closed layout keeps decision tray below board", /\.game-screen \.layout\.panel-closed>\.game-side-panel>\.action-card\{display:block;position:static/],
  ["explicit board layer order", /\.hex-tile \.tile-base\{[^}]*z-index:0[^}]*\}\.hex-tile \.tile-art\{[^}]*z-index:1[^}]*\}\.hex-tile \.tile-stomp\{[^}]*z-index:2[^}]*\}[^\n]*\.hex-tile \.tile-occupants\{[^}]*z-index:4/],
  ["bounded dense occupant stacks", /\.hex-tile \.tile-occupants\{[^}]*max-width:30px/],
  ["contained stack occupants", /\.hex-tile \.tile-occupant\{[^}]*max-width:24px/],
  ["eight-piece live stack classes", /stack-count-7[^}]*stack-count-8/],
  ["legal path above board layers", /\.path-preview\{[^}]*z-index:6/],
  ["audio range controls", /\.settings-audio input\[type="range"\]/],
  ["board themes affect terrain artwork only", /data-board-theme="moonlit"[^\n]*audited-terrain[\s\S]*data-board-theme="desert"[^\n]*audited-terrain/],
  ["audited city labels respond to larger-text preference", /\.large-text \.audited-grid \.hex-tile \.audited-city-name\{font-size:clamp\(/],
  ["focused board inspection opens its contextual tray", /\.game-screen\.game-panel-closed:has\(\.hex-tile:focus\) \.board-context-tray-focus \{ display:grid; \}/],
];
for (const [label, marker] of requiredStyleMarkers) if (!marker.test(styles)) failures.push(`missing ${label}`);

if (failures.length) {
  console.error(`Web accessibility contract failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Web accessibility source contract verified; manual WCAG and assistive-technology review remains separate.");
}
