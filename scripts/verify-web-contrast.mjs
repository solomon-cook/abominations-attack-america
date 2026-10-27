import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground, background) => {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
};
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sheetStyles = await readFile(resolve(root, "apps/web/src/physical-sheets.css"), "utf8");
const declarations = (selector, label) => {
  const match = sheetStyles.match(selector);
  if (!match) throw new Error(`Cannot find ${label} palette in physical-sheets.css.`);
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{3,8})\b/gi)].map((entry) => [entry[1], entry[2]]));
};
const baseSheet = declarations(/\.physical-military-sheet\s*\{([^}]*)\}/, "base sheet");
const sheetRules = [
  ["Army", null],
  ["Navy", /\.physical-military-sheet\[data-branch="Navy"\]\s*\{([^}]*)\}/],
  ["Marines", /\.physical-military-sheet\[data-branch="Marines"\]\s*\{([^}]*)\}/],
  ["Air Force", /\.physical-military-sheet\[data-branch="Air Force"\]\s*\{([^}]*)\}/],
  ["National Guard", /\.physical-military-sheet\[data-branch="National Guard"\]\s*\{([^}]*)\}/],
  ["Giant/X-Fighters", /\.physical-military-sheet\[data-branch="Giant"\],\.physical-military-sheet\[data-branch="X-Fighters"\]\s*\{([^}]*)\}/],
];
const sheetPalettes = sheetRules.map(([branch, selector]) => {
  const override = selector ? declarations(selector, `${branch} sheet`) : {};
  const palette = { ...baseSheet, ...override };
  for (const property of ["--sheet-color", "--sheet-ink", "--sheet-accent"]) {
    if (!palette[property]) throw new Error(`${branch} sheet is missing ${property}.`);
  }
  return [branch, palette["--sheet-color"], palette["--sheet-ink"], palette["--sheet-accent"]];
});
const pairs = [
  ["body copy", "#f4f1ea", "#171514"],
  ["muted copy", "#a99c91", "#211b19"],
  ["setup copy", "#c5b7a8", "#2a211b"],
  ["action button", "#201611", "#d77939"],
  ["board tile copy", "#f7f1d8", "#243d35"],
  ["settings copy", "#dce8d8", "#172117"],
  ["duel heading", "#f5d28e", "#211a17"],
  ["Mutation card copy", "#2a1815", "#f1e2c2"],
  ["Research card copy", "#14231f", "#e9e4c7"],
  ["shared card copy", "#202721", "#f0ead7"],
  ...sheetPalettes.flatMap(([branch, background, ink, accent]) => [
    [`${branch} sheet copy`, ink, background],
    [`${branch} sheet statistic labels`, accent, background],
  ]),
];
const failures = pairs.filter(([, foreground, background]) => contrast(foreground, background) < 4.5);
if (failures.length > 0) throw new Error(`Contrast pairs below WCAG AA normal-text threshold: ${failures.map(([name]) => name).join(", ")}`);
console.log(`Verified ${pairs.length} web contrast pairs at WCAG AA normal-text ratio, including every branch sheet and card palette.`);
