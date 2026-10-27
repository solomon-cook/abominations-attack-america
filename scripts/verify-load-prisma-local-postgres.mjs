import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(root, "apps/api");
const require = createRequire(resolve(apiRoot, "package.json"));
const prismaCli = require.resolve("prisma/build/index.js");
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

function resolvePostgresBinDir() {
  if (process.env.POSTGRES_BIN_DIR) return resolve(process.env.POSTGRES_BIN_DIR);
  try {
    return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Install PostgreSQL locally and put pg_config on PATH, or set POSTGRES_BIN_DIR to its bin directory.");
  }
}

function run(command, args, { cwd, env = process.env, timeoutMs = 180_000 } = {}) {
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

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a local PostgreSQL port."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

const postgresBinDir = resolvePostgresBinDir();
const pgCtl = join(postgresBinDir, "pg_ctl");
const initdb = join(postgresBinDir, "initdb");
const username = process.env.USER ?? process.env.LOGNAME;
if (!username) throw new Error("Could not determine the current OS user for the temporary PostgreSQL superuser.");
const workspace = await mkdtemp(join(tmpdir(), "abominations-prisma-load-"));
const dataDir = join(workspace, "data");
const pgLog = join(workspace, "postgres.log");
const port = await reservePort();
const databaseUrl = `postgresql://${encodeURIComponent(username)}@127.0.0.1:${port}/postgres?sslmode=disable`;
let postgresStarted = false;

const environment = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_URL: databaseUrl,
  PRISMA_DATABASE_URL: "",
  POSTGRES_URL: "",
  LOAD_PERSISTENCE: "prisma",
  LOAD_ROOMS: process.env.LOAD_ROOMS ?? "8",
  LOAD_RECONNECTS: process.env.LOAD_RECONNECTS ?? "2",
  LOAD_DURATION_SECONDS: process.env.LOAD_DURATION_SECONDS ?? "10",
};

try {
  const initialized = await run(initdb, ["-D", dataDir, "-U", username, "--auth-local=trust", "--auth-host=trust", "--no-sync", "--no-instructions", "--locale=C", "-E", "UTF8"]);
  assert.equal(initialized.code, 0, `Temporary PostgreSQL initialization failed:\n${initialized.stdout}\n${initialized.stderr}`);

  const started = await run(pgCtl, ["-D", dataDir, "-l", pgLog, "-o", `-h 127.0.0.1 -p ${port} -c max_connections=100`, "-w", "start"]);
  assert.equal(started.code, 0, `Temporary PostgreSQL startup failed:\n${started.stdout}\n${started.stderr}`);
  postgresStarted = true;

  const migration = await run(process.execPath, [prismaCli, "migrate", "deploy", "--config", "prisma.config.ts"], {
    cwd: apiRoot,
    env: environment,
  });
  assert.equal(migration.code, 0, `Prisma migrations failed:\n${migration.stdout}\n${migration.stderr}`);

  const load = await run(process.execPath, ["scripts/load-test-development-api.mjs"], {
    cwd: root,
    env: environment,
    timeoutMs: 240_000,
  });
  const output = `${load.stdout}${load.stderr}`.replaceAll(databaseUrl, "[temporary local PostgreSQL DATABASE_URL]");
  assert.equal(load.code, 0, `Prisma-backed API load failed:\n${output}`);
  process.stdout.write(output);
  console.log("Prisma-backed API load passed against a real, temporary local PostgreSQL 17 server; managed-host capacity and multi-process behavior remain separate.");
} finally {
  if (postgresStarted) {
    const stopped = await run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    if (stopped.code !== 0) process.stderr.write(`Temporary PostgreSQL shutdown failed:\n${stopped.stdout}\n${stopped.stderr}`);
  }
  await rm(workspace, { recursive: true, force: true });
}
