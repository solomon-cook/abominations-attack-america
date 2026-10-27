import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));
const prismaCli = require.resolve("prisma/build/index.js");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function run(command, args, { cwd, env, timeoutMs = 180_000 }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      resolveRun({ code, signal, stdout, stderr });
    });
  });
}

const database = await PGlite.create();
const postgres = new PGLiteSocketServer({ db: database, host: "127.0.0.1", port: 0, maxConnections: 8 });
let databaseUrl;

try {
  await postgres.start();
  databaseUrl = `postgresql://postgres:postgres@${postgres.getServerConn()}/postgres?sslmode=disable`;
  const environment = { ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl };

  const migration = await run(process.execPath, [prismaCli, "migrate", "deploy", "--config", "prisma.config.ts"], {
    cwd: apiRoot,
    env: environment,
  });
  assert.equal(migration.code, 0, `Prisma migrations failed:\n${migration.stdout}\n${migration.stderr}`);

  const routeCheck = await run(process.execPath, [
    "--import", "tsx", "--test", "--test-name-pattern=API room can reach America Saved",
    "apps/api/src/server.integration.test.ts",
  ], {
    cwd: root,
    env: { ...environment, API_VICTORY_ROUTE_PERSISTENCE: "prisma" },
    timeoutMs: 300_000,
  });
  const output = `${routeCheck.stdout}${routeCheck.stderr}`.replaceAll(databaseUrl, "[disposable PGlite DATABASE_URL]");
  assert.equal(routeCheck.code, 0, `Prisma-backed API victory routes failed:\n${output}`);
  process.stdout.write(output);
  console.log("Prisma-backed API victory routes passed against a fresh disposable PGlite database.");
} finally {
  await postgres.stop();
  await database.close();
}
