import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rulesPath = join(root, "docs", "monsters-menace-america-rules.md");
const matrixPath = join(root, "docs", "rules-traceability-matrix.md");
const rules = readFileSync(rulesPath, "utf8");
const matrix = readFileSync(matrixPath, "utf8");

const headings = [...rules.matchAll(/^#{2,4} (.+)$/gm)].map((match) => match[1].trim());
const rows = matrix.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| ---"));
const covered = new Set(rows.slice(1).map((line) => line.split("|")[1].trim()));
const missing = headings.filter((heading) => !covered.has(heading));

if (missing.length > 0) {
  throw new Error(`Traceability matrix is missing rules sections: ${missing.join(", ")}`);
}

for (const row of rows.slice(1)) {
  const cells = row.split("|").slice(1, -1);
  if (cells.length !== 5) throw new Error(`Traceability row must have five columns: ${row}`);
  if (!["Foundation", "Partial", "Unresolved"].includes(cells[4].trim())) {
    throw new Error(`Traceability row has an invalid status: ${row}`);
  }
}

for (const relativePath of ["docs/rules-source.md", "docs/monsters-menace-america-rules.md", "packages/game-engine/src/index.ts", "apps/web/src/main.tsx"]) {
  if (!existsSync(join(root, relativePath))) throw new Error(`Traceability source does not exist: ${relativePath}`);
}

console.log(`Verified ${headings.length} rules sections in ${matrixPath}`);
