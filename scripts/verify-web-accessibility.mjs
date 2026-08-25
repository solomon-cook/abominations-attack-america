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
  ["cream die face textures", /\/assets\/dice\/d6-face-6\.webp/],
  ["authoritative die result label", /aria-label=\{`Roll \$\{index \+ 1\}: \$\{roll\}`\}/],
  ["recorded encounter result", /aria-label="Recorded encounter result"/],
  ["accepted action feedback", /<ActionResolutionFeedback label=\{acceptedActionFeedback\?\.label\}/],
  ["encounter authoritative dice", /aria-label="Recorded encounter dice rolls"/],
  ["Hollywood recovery die", /aria-label="Recorded Hollywood recovery die"/],
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
];
for (const [label, marker] of requiredStyleMarkers) if (!marker.test(styles)) failures.push(`missing ${label}`);

if (failures.length) {
  console.error(`Web accessibility contract failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Web accessibility source contract verified; manual WCAG and assistive-technology review remains separate.");
}
