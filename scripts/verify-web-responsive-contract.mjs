import { readFile } from "node:fs/promises";

const stylesheet = await readFile(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

const requirements = [
  ["dynamic viewport height", /\.game-screen\{height:100dvh;max-height:100dvh/],
  ["safe-area insets", /safe-area-inset-(top|right|bottom|left)/],
  ["mobile single-column layout", /@media\(max-width:700px\)[\s\S]*?\.game-screen>.layout\{display:grid;grid-template-columns:1fr/],
  ["mobile bounded board panel", /@media\(max-width:700px\)[\s\S]*?\.game-screen \.board-panel\{padding:8px;overflow-y:auto/],
  ["mobile action dock sizing", /@media\(max-width:560px\)\{\.action-dock\{right:10px;bottom:10px;min-width:160px/],
  ["touch-sized map controls", /\.map-controls button\{[^}]*min-width:44px[^}]*min-height:44px/],
  ["touch-sized gameplay controls", /\.game-screen \.setup-options button,[\s\S]*?\.game-screen \.settings-grid label\{min-height:44px\}/],
  ["touch-drag board surface", /\.map\{touch-action:none/],
  ["landscape board canvas", /\.game-screen \.hex-grid\{left:2\.2%;right:2\.2%;top:50%;bottom:auto;height:auto;aspect-ratio:1\.77646/],
  ["board-adjacent action bar", /\.game-screen \.board-action-bar\{position:static/],
  ["compact separated hexagonal development pins", /\.hex-tile\.development-fixture\{width:3\.2%;aspect-ratio:1\.1547005;clip-path:polygon\(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%\);border:2px solid #f0d89a/],
  ["horizontal overflow containment", /html,body,#root\{width:100%;max-width:100%;overflow-x:clip\}/],
  ["reduced-motion media contract", /@media\(prefers-reduced-motion:reduce\)/],
];

const missing = requirements.filter(([, pattern]) => !pattern.test(stylesheet)).map(([name]) => name);
if (!/const cameraMode = mapZoom >= 1\.25 \? "Tactical detail" : "Strategic overview"/.test(mainSource) || !/className="map-camera-mode"/.test(mainSource)) {
  missing.push("strategic/tactical camera mode indicator");
}
if (missing.length > 0) {
  throw new Error(`Responsive web contract missing: ${missing.join(", ")}`);
}

console.log(`Verified ${requirements.length} responsive layout contracts; screenshot and manual browser review remain separate.`);
