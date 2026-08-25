import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const componentFiles = (await readdir(resolve(root, "apps/web/src/components")))
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => resolve(root, "apps/web/src/components", file));
const source = [
  await readFile(resolve(root, "apps/web/src/main.tsx"), "utf8"),
  ...(await Promise.all(componentFiles.map((file) => readFile(file, "utf8")))),
].join("\n");
const styles = await readFile(resolve(root, "apps/web/src/styles.css"), "utf8");
const failures = [];

const requiredSourceMarkers = [
  ["main landmark", /<main\b/],
  ["named map group", /aria-label=\"Full honeycomb board coordinate shell\"/],
  ["hex accessible names", /aria-label=\{`[\s\S]*\$\{displayName\}[\s\S]*hex \$\{hex\.key\}/],
  ["live match status", /aria-live=\"polite\" aria-label=\"Match status\"/],
  ["alert errors", /className=\"error\" role=\"alert\"/],
  ["unknown board pins fail closed", /className=\"board-unavailable\" role=\"alert\"/],
  ["keyboard-native controls", /<button[\s\S]*onClick=/],
  ["decorative map stays separate from authoritative canvas", /className=\"map-canvas\"/],
  ["monster artwork", /\/assets\/monsters\/\$\{slug\}\.webp/],
  ["Infamy token artwork", /\/assets\/board\/tokens\/infamy_token\.webp/],
  ["revealed card artwork", /\/assets\/cards\/monster-mutation-01\.webp/],
  ["city benefit labels", /printed city benefit/],
  ["Mutation labels", />MUTATION<\//],
  ["pointer-drag board controls", /onPointerMove=\{moveMapDrag\}/],
  ["wheel board zoom", /onWheel=\{zoomMapWithWheel\}/],
  ["hover path preview", /onMouseEnter=\{\(\) => \(monsterLegal \|\| unitLegal\)/],
  ["cream die face textures", /\/assets\/dice\/d6-face-\$\{face\}\.webp/],
  ["authoritative die result label", /aria-label=\{label\}/],
  ["recorded encounter result", /aria-label="Recorded encounter result"/],
  ["accepted action feedback", /<ActionResolutionFeedback label=\{acceptedActionFeedback\?\.label\}/],
  ["encounter authoritative dice", /aria-label="Recorded encounter dice rolls"/],
  ["Hollywood recovery die", /aria-label="Recorded Hollywood recovery die"/],
  ["Monster Challenge duel surface", /aria-label="Recorded Monster Challenge duel"/],
  ["authoritative Challenge Health replay", /targetHealthBefore/],
  ["contextual decision rules help", /aria-label="Rules help for current decision"/],
  ["development fixture overlay", /development-fixture/],
  ["viewport-fitted gameplay shell", /className=\{`game-screen/],
  ["on-demand game panel toggle", /aria-controls="game-side-panel"/],
  ["named game controls panel", /id="game-side-panel" className="game-side-panel" aria-label="Game controls and information"/],
  ["private hand details", /aria-label=\{`Private hand for Player/],
  ["card rule metadata", /aria-label=\{`\$\{cardId\} rule metadata`/],
  ["card source and target boundaries", /Target and confirmation:[\s\S]*Source:/],
  ["encounter resolution action", /activeGame\.pendingDecision\?\.type === "encounter-resolution"[\s\S]*Resolve encounter/],
  ["audio feedback categories", /playSound\(category/],
  ["persisted audio settings", /type="range" min="0" max="1"/],
];
for (const [label, marker] of requiredSourceMarkers) if (!marker.test(source)) failures.push(`missing ${label}`);

const requiredStyleMarkers = [
  ["visible focus treatment", /:focus-visible/],
  ["reduced motion", /prefers-reduced-motion:reduce/],
  ["manual reduced motion", /manual-reduced-motion/],
  ["touch-sized map controls", /\.map-controls button\{[^}]*min-width:44px[^}]*min-height:44px/],
  ["no horizontal overflow", /overflow-x:clip/],
  ["generated decorative map backdrop", /\.map::after\{/],
  ["touch-drag board viewport", /\.map\{touch-action:none/],
  ["3D die transforms", /transform-style:preserve-3d/],
  ["reduced-motion dice", /\.combat-die \.die-cube\{animation:none\}/],
  ["encounter result surface", /\.encounter-result\{/],
  ["accepted action motion", /\.action-resolution-feedback\{/],
  ["uncropped authored artwork", /\.hex-tile \.tile-art\{object-fit:contain;object-position:center\}/],
  ["uncropped revealed cards", /\.revealed-card-art\{object-fit:contain;object-position:center;background:/],
  ["viewport-fitted gameplay layout", /\.game-screen\{height:100dvh;max-height:100dvh/],
  ["board-first closed layout", /\.game-screen \.layout\.panel-closed\{grid-template-columns:minmax\(0,1fr\)/],
  ["closed layout hides secondary board details", /\.game-screen \.layout\.panel-closed \.board-secondary\{display:none\}/],
  ["audio range controls", /\.settings-audio input\[type="range"\]/],
];
for (const [label, marker] of requiredStyleMarkers) if (!marker.test(styles)) failures.push(`missing ${label}`);

if (failures.length) {
  console.error(`Web accessibility contract failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Web accessibility source contract verified; manual WCAG and assistive-technology review remains separate.");
}
