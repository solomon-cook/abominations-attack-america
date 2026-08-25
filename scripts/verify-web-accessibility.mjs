import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const mainSource = await readFile(resolve(root, "apps/web/src/main.tsx"), "utf8");
const styles = await readFile(resolve(root, "apps/web/src/styles.css"), "utf8");
const failures = [];

const requiredSourceMarkers = [
  ["main landmark", /<main\b/],
  ["named map group", /aria-label=\"Full honeycomb board coordinate shell\"/],
  ["hex accessible names", /aria-label=\{`\$\{displayName\}, hex \$\{hex\.key\}/],
  ["live match status", /aria-live=\"polite\" aria-label=\"Match status\"/],
  ["alert errors", /className=\"error\" role=\"alert\"/],
  ["keyboard-native controls", /<button[\s\S]*onClick=/],
  ["reference image has alt boundary", /className=\"board-photo-backdrop\"[\s\S]{0,180}alt=\"\"[\s\S]{0,80}aria-hidden=\"true\"/],
];
for (const [label, marker] of requiredSourceMarkers) if (!marker.test(mainSource)) failures.push(`missing ${label}`);

const requiredStyleMarkers = [
  ["visible focus treatment", /:focus-visible/],
  ["reduced motion", /prefers-reduced-motion:reduce/],
  ["manual reduced motion", /manual-reduced-motion/],
  ["touch-sized map controls", /\.map-controls button\{[^}]*min-width:44px[^}]*min-height:44px/],
  ["no horizontal overflow", /overflow-x:clip/],
];
for (const [label, marker] of requiredStyleMarkers) if (!marker.test(styles)) failures.push(`missing ${label}`);

if (failures.length) {
  console.error(`Web accessibility contract failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Web accessibility source contract verified; manual WCAG and assistive-technology review remains separate.");
}
