import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const rootPackage = JSON.parse(readFileSync("package.json", "utf8"));
const scriptsByWorkspace = new Map([["root", rootPackage.scripts ?? {}]]);

for (const pattern of rootPackage.workspaces ?? []) {
  const wildcardIndex = pattern.indexOf("*");
  const parent = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex).replace(/\/$/, "");
  const entries = wildcardIndex === -1
    ? ["."]
    : readdirSync(parent, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(parent, entry.name));
  for (const folder of entries) {
    try {
      const workspacePackage = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
      scriptsByWorkspace.set(workspacePackage.name, workspacePackage.scripts ?? {});
    } catch {
      // A workspace glob can contain folders that are not packages.
    }
  }
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

const references = [];
const commandPatterns = [
  /\bnpm\s+--workspace(?:=|\s+)(?<workspace>[^\s`]+)\s+run(?:\s+--[a-z-]+(?:=[^\s`]+)?)*\s+(?<script>[A-Za-z0-9][A-Za-z0-9:_-]*)/g,
  /\bnpm\s+run(?:\s+--[a-z-]+(?:=[^\s`]+)?)*\s+(?<script>[A-Za-z0-9][A-Za-z0-9:_-]*)/g,
];

for (const file of markdownFiles("docs")) {
  const markdown = readFileSync(file, "utf8");
  for (const pattern of commandPatterns) {
    for (const match of markdown.matchAll(pattern)) {
      const workspace = match.groups?.workspace ?? "root";
      references.push({ file, workspace, script: match.groups.script });
    }
  }
}

const missing = references.filter(({ workspace, script }) => !scriptsByWorkspace.get(workspace)?.[script]);
if (missing.length) {
  for (const { file, workspace, script } of missing) {
    process.stderr.write(`${relative(process.cwd(), file)}: npm ${workspace === "root" ? "run" : `--workspace ${workspace} run`} ${script} does not exist in that package's scripts.\n`);
  }
  process.stderr.write(`Checked ${references.length} documented npm run command references; found ${missing.length} missing script(s).\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${references.length} documented npm run command references across ${scriptsByWorkspace.size} workspaces.\n`);
}
