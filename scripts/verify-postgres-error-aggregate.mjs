import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/generated/prisma/client.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));
const tsxCli = require.resolve("tsx/cli");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Set DATABASE_URL to a disposable PostgreSQL database with project migrations applied.");

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const reservePort = () => new Promise((resolvePort, reject) => {
  const server = createNetServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return reject(new Error("Could not reserve a local API port."));
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
let child;
let output = "";

function startApi() {
  output = "";
  child = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: apiRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "development",
      PERSISTENCE: "prisma",
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API exited before health became ready:\n${output.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch { /* API has not bound yet. */ }
    await wait(100);
  }
  throw new Error(`API did not become healthy:\n${output.replaceAll(databaseUrl, "[DATABASE_URL]")}`);
}

async function stopApi() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function waitForCount(day, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await prisma.errorReportAggregate.findUnique({
      where: { bucketDate_category: { bucketDate: new Date(`${day}T00:00:00.000Z`), category: "http" } },
    });
    if ((row?.count ?? 0) === expected) return row.count;
    await wait(100);
  }
  const row = await prisma.errorReportAggregate.findUnique({
    where: { bucketDate_category: { bucketDate: new Date(`${day}T00:00:00.000Z`), category: "http" } },
  });
  throw new Error(`Expected ${expected} HTTP errors for ${day}, found ${row?.count ?? 0}.`);
}

try {
  const day = new Date().toISOString().slice(0, 10);
  const bucketDate = new Date(`${day}T00:00:00.000Z`);
  const initial = await prisma.errorReportAggregate.findUnique({ where: { bucketDate_category: { bucketDate, category: "http" } } });
  const baseline = initial?.count ?? 0;

  startApi();
  await waitForHealth();
  const first = await fetch(`${baseUrl}/rooms/MISSING-${Date.now()}/state`);
  assert.equal(first.status, 400, "unknown-room lookup should surface through the API error-reporting path");
  await waitForCount(day, baseline + 1);
  await stopApi();

  const afterRestart = await prisma.errorReportAggregate.findUnique({ where: { bucketDate_category: { bucketDate, category: "http" } } });
  assert.equal(afterRestart?.count, baseline + 1, "aggregate must remain in Postgres after the API process exits");

  startApi();
  await waitForHealth();
  const second = await fetch(`${baseUrl}/rooms/MISSING-${Date.now()}/state`);
  assert.equal(second.status, 400);
  const persistedCount = await waitForCount(day, baseline + 2);
  console.log(`PostgreSQL error aggregate persisted ${persistedCount - baseline} HTTP reports across an API restart; personal/request data is not stored.`);
} finally {
  await stopApi();
  await prisma.$disconnect();
}
