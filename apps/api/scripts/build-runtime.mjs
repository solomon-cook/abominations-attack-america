import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledEntry = resolve(apiRoot, "dist/apps/api/src/server.js");
const compiledGameEngine = resolve(apiRoot, "dist/packages/game-engine/src/index.js");

await build({
  absWorkingDir: apiRoot,
  entryPoints: [compiledEntry],
  outfile: resolve(apiRoot, "dist/server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  alias: {
    "@abominations/game-engine": compiledGameEngine,
  },
});
