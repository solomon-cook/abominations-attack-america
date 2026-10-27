import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../apps/web/dist/", import.meta.url));
const visit = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error("Web production output is missing; run the Vite production build first.");
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await visit(path));
    else if (/\.(?:js|css|html)$/i.test(entry.name)) files.push(path);
  }
  return files;
};

const files = await visit(root);
if (files.length === 0) throw new Error("Web production output contains no JavaScript, CSS, or HTML files.");
for (const file of files) {
  const contents = await readFile(file, "utf8");
  if (/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(contents)) {
    throw new Error(`Production asset contains a loopback URL: ${file}`);
  }
}

console.log(`Production web assets contain no loopback URLs (${files.length} files checked).`);
