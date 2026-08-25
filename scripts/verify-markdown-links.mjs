import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const markdownFiles = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.isFile() && entry.name.endsWith(".md")) markdownFiles.push(path);
  }
}
walk(root);
const failures = [];
for (const file of markdownFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, "");
    if (!target || /^(?:https?:|mailto:|#)/.test(target)) continue;
    const localTarget = target.split("#", 1)[0].split("?", 1)[0];
    if (localTarget && !existsSync(resolve(dirname(file), localTarget))) failures.push(`${file}: missing ${target}`);
  }
}
if (failures.length) throw new Error(`Markdown link check failed:\n${failures.join("\n")}`);
console.log(`Verified ${markdownFiles.length} Markdown files and all local links.`);
