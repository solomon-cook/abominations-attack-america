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
const postgresBinDir = resolvePostgresBinDir();
const pgCtl = join(postgresBinDir, "pg_ctl");
const initdb = join(postgresBinDir, "initdb");
const psql = join(postgresBinDir, "psql");
const prismaCli = createRequire(resolve(apiRoot, "package.json")).resolve("prisma/build/index.js");
const username = process.env.USER ?? process.env.LOGNAME;
if (!username) throw new Error("Could not determine the current OS user for the temporary PostgreSQL superuser.");

function resolvePostgresBinDir() {
  if (process.env.POSTGRES_BIN_DIR) return resolve(process.env.POSTGRES_BIN_DIR);
  try {
    return execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Install PostgreSQL locally and put pg_config on PATH, or set POSTGRES_BIN_DIR to its bin directory.");
  }
}

function run(command, args, { cwd, env = process.env, timeoutMs = 300_000 } = {}) {
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

const workspace = await mkdtemp(join(tmpdir(), "abominations-replay-postgres-"));
const dataDir = join(workspace, "data");
const pgLog = join(workspace, "postgres.log");
const benchmarkReportPath = join(workspace, "replay-benchmark.json");
const port = await reservePort();
const databaseUrl = `postgresql://${encodeURIComponent(username)}@127.0.0.1:${port}/postgres?sslmode=disable`;
const environment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: databaseUrl,
  PRISMA_DATABASE_URL: "",
  POSTGRES_URL: "",
  PERSISTENCE: "prisma",
  API_VICTORY_ROUTE_PERSISTENCE: "prisma",
};
let postgresStarted = false;

async function databaseMetrics() {
  const sql = `SELECT pg_database_size(current_database()), count(*), count(*) FILTER (WHERE "replayCommand" IS NOT NULL), COALESCE(sum(pg_column_size("replayCommand")) FILTER (WHERE "replayCommand" IS NOT NULL), 0), COALESCE(sum(pg_column_size(payload)), 0), pg_total_relation_size('"GameEvent"') FROM "GameEvent";`;
  const result = await run(psql, ["--no-psqlrc", "-X", "-qAt", "--set=ON_ERROR_STOP=1", databaseUrl, "-c", sql]);
  assert.equal(result.code, 0, `PostgreSQL metrics query failed:\n${result.stdout}\n${result.stderr}`);
  const fields = result.stdout.trim().split("|").map(Number);
  assert.equal(fields.length, 6, `Unexpected PostgreSQL metrics row: ${result.stdout}`);
  assert.ok(fields.every(Number.isFinite), `Non-numeric PostgreSQL metrics row: ${result.stdout}`);
  return {
    databaseBytes: fields[0],
    eventRows: fields[1],
    replayCommandRows: fields[2],
    replayCommandJsonBytes: fields[3],
    eventPayloadJsonBytes: fields[4],
    gameEventRelationBytes: fields[5],
  };
}

try {
  const initialized = await run(initdb, ["-D", dataDir, "-U", username, "--auth-local=trust", "--auth-host=trust", "--no-sync", "--no-instructions", "--locale=C", "-E", "UTF8"]);
  assert.equal(initialized.code, 0, `Temporary PostgreSQL initialization failed:\n${initialized.stdout}\n${initialized.stderr}`);

  const started = await run(pgCtl, ["-D", dataDir, "-l", pgLog, "-o", `-h 127.0.0.1 -p ${port} -c max_connections=100`, "-w", "start"]);
  assert.equal(started.code, 0, `Temporary PostgreSQL startup failed:\n${started.stdout}\n${started.stderr}`);
  postgresStarted = true;

  const migration = await run(process.execPath, [prismaCli, "migrate", "deploy", "--config", "prisma.config.ts"], { cwd: apiRoot, env: environment });
  assert.equal(migration.code, 0, `Prisma migrations failed:\n${migration.stdout}\n${migration.stderr}`);
  const before = await databaseMetrics();

  const benchmark = await run(process.execPath, [
    "--import", "tsx", "--test", "--test-isolation=none", "--test-reporter=tap",
    "--test-name-pattern=3-player API room can reach America Saved through legal room actions",
    "apps/api/src/server.integration.test.ts",
  ], {
    cwd: root,
    env: { ...environment, REPLAY_BENCHMARK: "1", REPLAY_BENCHMARK_OUTPUT: benchmarkReportPath },
    timeoutMs: 300_000,
  });
  const benchmarkOutput = `${benchmark.stdout}${benchmark.stderr}`.replaceAll(databaseUrl, "[temporary local PostgreSQL DATABASE_URL]");
  if (benchmark.code !== 0) {
    let diagnostic = "";
    try { diagnostic = `\nBenchmark diagnostic: ${await readFile(benchmarkReportPath, "utf8")}`; } catch { /* The API test failed before producing a replay response. */ }
    if (diagnostic) process.stdout.write(`${diagnostic}\n`);
    throw new Error(`Prisma-backed replay route benchmark failed (exit ${benchmark.code}, signal ${benchmark.signal ?? "none"}):\n${benchmarkOutput}${diagnostic}`);
  }
  const replay = JSON.parse(await readFile(benchmarkReportPath, "utf8"));
  const after = await databaseMetrics();
  assert.equal(after.eventRows - before.eventRows, replay.terminalVersion);
  assert.equal(after.replayCommandRows - before.replayCommandRows, replay.terminalVersion);

  const report = {
    benchmark: "postgres-replay-source",
    database: "temporary-local-postgresql",
    replay,
    postgres: {
      eventRows: after.eventRows - before.eventRows,
      replayCommandRows: after.replayCommandRows - before.replayCommandRows,
      replayCommandJsonBytes: after.replayCommandJsonBytes - before.replayCommandJsonBytes,
      eventPayloadJsonBytes: after.eventPayloadJsonBytes - before.eventPayloadJsonBytes,
      gameEventRelationBytes: after.gameEventRelationBytes - before.gameEventRelationBytes,
      wholeDatabaseBytesBefore: before.databaseBytes,
      wholeDatabaseBytesAfter: after.databaseBytes,
      wholeDatabaseGrowthBytes: after.databaseBytes - before.databaseBytes,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  console.log("This is a single local PostgreSQL sample, not selected-host, multi-process, or managed-service capacity evidence.");
} finally {
  if (postgresStarted) {
    const stopped = await run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    if (stopped.code !== 0) process.stderr.write(`Temporary PostgreSQL shutdown failed:\n${stopped.stdout}\n${stopped.stderr}`);
  }
  await rm(workspace, { recursive: true, force: true });
}
