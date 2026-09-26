import { readFile } from "node:fs/promises";

const stylesheet = (await Promise.all(["styles.css", "encounter-command.css", "combat-stage.css", "dice.css"].map(file => readFile(new URL(`../apps/web/src/${file}`, import.meta.url), "utf8")))).join("\n");
const failures = [];

const animationDeclarations = [...stylesheet.matchAll(/animation\s*:\s*([^;{}]+)/g)].map((match) => match[1].replace(/!important/g, "").trim());
const transitionDeclarations = [...stylesheet.matchAll(/transition\s*:\s*([^;{}]+)/g)].map((match) => match[1].replace(/!important/g, "").trim());

// Retreat destination tiles intentionally pulse as a map affordance. That map
// highlight is deferred under UI item #10 and already has a reduced-motion
// override; all other motion in this audited set must settle.
const intentionalMapAffordance = "retreat-hex-pulse 1.35s ease-in-out infinite";
if (animationDeclarations.some((value) => /\binfinite\b/.test(value) && value !== intentionalMapAffordance)) failures.push("infinite CSS animation outside the deferred retreat highlight");
if (!/\.hex-tile\.retreat-legal\{animation:none\}/.test(stylesheet)) failures.push("retreat highlight ignores reduced-motion preference");
if (animationDeclarations.some((value) => value !== "none" && !/\b(?:0|0?\.\d+|\d+(?:\.\d+)?)s\b/.test(value))) failures.push("animation without an explicit finite duration");
if (transitionDeclarations.some((value) => /\binfinite\b/.test(value) || [...value.matchAll(/(?:^|[ ,])(\d*\.?\d+)(ms|s)\b/g)].some((match) => Number(match[1]) / (match[2] === "ms" ? 1000 : 1) >= 2))) failures.push("unbounded transition duration");
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*animation-duration:\s*0\.01ms\s*!important/.test(stylesheet)) failures.push("global reduced-motion animation override");
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition-duration:\s*0\.01ms\s*!important/.test(stylesheet)) failures.push("global reduced-motion transition override");
if (!/\.accepted-path polyline[\s\S]*animation:accepted-path-in/.test(stylesheet) || !/@keyframes accepted-path-in[\s\S]*100%\{opacity:0/.test(stylesheet)) failures.push("accepted-path animation does not settle");
if (!/\.accepted-arrival[\s\S]*animation:accepted-arrival-in/.test(stylesheet) || !/@keyframes accepted-arrival-in[\s\S]*100%\{[^}]*opacity:1/.test(stylesheet)) failures.push("accepted-arrival animation does not settle");

if (failures.length) {
  console.error(`Web motion contract failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Verified ${animationDeclarations.length} finite animation declarations, ${transitionDeclarations.length} bounded transitions, and global reduced-motion interruption.`);
}
