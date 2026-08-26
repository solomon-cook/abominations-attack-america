import { readFile } from "node:fs/promises";

const stylesheet = await readFile(new URL("../apps/web/src/styles.css", import.meta.url), "utf8");
const failures = [];

const animationDeclarations = [...stylesheet.matchAll(/animation\s*:\s*([^;{}]+)/g)].map((match) => match[1].trim());
const transitionDeclarations = [...stylesheet.matchAll(/transition\s*:\s*([^;{}]+)/g)].map((match) => match[1].trim());

if (animationDeclarations.some((value) => /\binfinite\b/.test(value))) failures.push("infinite CSS animation");
if (animationDeclarations.some((value) => value !== "none" && !/\b(?:0|0?\.\d+|\d+(?:\.\d+)?)s\b/.test(value))) failures.push("animation without an explicit finite duration");
if (transitionDeclarations.some((value) => /\b(?:infinite|[2-9]\d*(?:\.\d+)?s)\b/.test(value))) failures.push("unbounded transition duration");
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
