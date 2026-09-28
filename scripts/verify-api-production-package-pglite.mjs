import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRootRelative = "apps/api";
const evidenceRelativePath = `output/api-review/compiled-api-bundle-pglite-${new Date().toISOString().slice(0, 10)}.json`;
const evidencePath = join(repoRoot, evidenceRelativePath);
const commandResults = [];
const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  commandResults.push({
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdoutTail: (result.stdout ?? "").slice(-1200),
    stderrTail: (result.stderr ?? "").slice(-1200),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.\n${result.stdout}\n${result.stderr}`);
  return result;
}

async function copyTree(source, destination, excluded = new Set(["node_modules", "dist"])) {
  await cp(source, destination, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path);
      if (!rel) return true;
      const parts = rel.split(sep);
      return !parts.some((part) => excluded.has(part)) && !parts.some((part) => part === ".env" || part.startsWith(".env."));
    },
  });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function applyMigrations(db, migrationRoot) {
  const directories = (await readdir(migrationRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.ok(directories.length > 0, "expected checked-in Prisma migration directories");
  for (const directory of directories) {
    await db.exec(await readFile(join(migrationRoot, directory, "migration.sql"), "utf8"));
  }
  return directories;
}

async function waitForHealth(child, baseUrl) {
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.outputText = () => output;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Compiled API exited during startup (${child.exitCode}).\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {
      // The server can take a moment to load the generated Prisma client.
    }
    await wait(50);
  }
  throw new Error(`Compiled API did not become healthy.\n${output}`);
}

async function packageExists(root, packageName) {
  const visited = new Set();
  const packagePath = packageName.split("/");

  async function visit(directory) {
    let resolved;
    try {
      resolved = await realpath(directory);
    } catch {
      return false;
    }
    if (visited.has(resolved)) return false;
    visited.add(resolved);

    if (directory.split(sep).at(-1) === "node_modules") {
      try {
        await access(join(resolved, ...packagePath, "package.json"));
        return true;
      } catch {
        // Check nested package trees below this node_modules directory.
      }
    }

    let entries;
    try {
      entries = await readdir(resolved, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (await visit(join(resolved, entry.name))) return true;
    }
    return false;
  }

  return visit(root);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    wait(5_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL"); }),
  ]);
}

async function requestJson(baseUrl, path, { method = "GET", body, roomToken } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (roomToken) headers["x-room-token"] = roomToken;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : undefined; }
  catch { data = text; }
  return { status: response.status, data };
}

const scratchRoot = await mkdtemp(join(tmpdir(), "aaa-api-production-package-"));
const keepScratch = process.env.KEEP_API_PACKAGE_SCRATCH === "1";
let db;
let socketServer;
let apiProcess;
let evidence;

try {
  assert.equal(process.versions.node.split(".")[0], "24", "this acceptance slice requires Node 24");
  await cp(join(repoRoot, "package.json"), join(scratchRoot, "package.json"));
  await cp(join(repoRoot, "package-lock.json"), join(scratchRoot, "package-lock.json"));
  await copyTree(join(repoRoot, "apps/api"), join(scratchRoot, "apps/api"));
  await copyTree(join(repoRoot, "packages/game-engine"), join(scratchRoot, "packages/game-engine"));
  await copyTree(join(repoRoot, "packages/shared"), join(scratchRoot, "packages/shared"));
  await mkdir(join(scratchRoot, "apps/web/src"), { recursive: true });
  await cp(join(repoRoot, "apps/web/package.json"), join(scratchRoot, "apps/web/package.json"));
  for (const file of ["connection-lease.ts", "command-ack.ts"]) {
    await cp(join(repoRoot, "apps/web/src", file), join(scratchRoot, "apps/web/src", file));
  }

  run(npmCommand, ["ci", "--include=dev"], scratchRoot);
  run(npmCommand, ["--workspace", "@abominations/api", "run", "prisma:generate"], scratchRoot);
  run(npmCommand, ["run", "build:api"], scratchRoot);

  const apiRoot = join(scratchRoot, apiRootRelative);
  const runtimeBundlePath = join(apiRoot, "dist/server.js");
  const bundle = await readFile(runtimeBundlePath, "utf8");
  assert.doesNotMatch(bundle, /@abominations\/game-engine/, "runtime bundle must not retain any game-engine package reference");
  assert.match(bundle, /GameDomainError/);

  run(npmCommand, ["prune", "--omit=dev", "--omit=optional", "--omit=peer"], scratchRoot);
  const filteredAudit = run(npmCommand, ["audit", "--omit=dev", "--omit=optional", "--omit=peer", "--json"], scratchRoot);
  const audit = JSON.parse(filteredAudit.stdout);
  assert.equal(audit.metadata?.vulnerabilities?.total ?? 0, 0, "pruned runtime dependency closure should have no reported advisories");

  for (const packageName of ["esbuild", "prisma", "@prisma/config", "deepmerge-ts", "mysql2", "@electric-sql/pglite"]) {
    assert.equal(await packageExists(scratchRoot, packageName), false, `${packageName} should be absent from the pruned runtime tree`);
  }
  for (const packageName of ["@prisma/client", "@prisma/adapter-pg", "pg", "ws", "dotenv"]) {
    assert.equal(await packageExists(scratchRoot, packageName), true, `${packageName} must remain in the pruned runtime tree`);
  }

  db = await PGlite.create();
  const migrations = await applyMigrations(db, join(apiRoot, "prisma/migrations"));
  socketServer = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 16 });
  let listening;
  socketServer.addEventListener("listening", (event) => { listening = event.detail; });
  await socketServer.start();
  assert.ok(listening?.port, "PGlite socket server must report its selected port");

  const apiPort = await reservePort();
  const baseUrl = `http://127.0.0.1:${apiPort}`;
  const origin = baseUrl;
  const child = spawn(npmCommand, ["--workspace", "@abominations/api", "run", "start"], {
    cwd: scratchRoot,
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${listening.port}/postgres`,
      PERSISTENCE: "prisma",
      NODE_ENV: "development",
      PORT: String(apiPort),
      ALLOWED_ORIGIN: origin,
      WEB_APP_URL: origin,
      ALLOW_DEVELOPMENT_FIXTURE: "false",
      ACCOUNT_EMAIL_DELIVERY_URL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess = child;
  const health = await waitForHealth(child, baseUrl);
  assert.deepEqual(health, { ok: true, persistence: "prisma" });

  const created = await requestJson(baseUrl, "/rooms", {
    method: "POST",
    body: { maxPlayers: 2, displayName: "Bundle Probe", privacy: "private" },
  });
  assert.equal(created.status, 201, `room creation failed: ${JSON.stringify(created.data)}`);
  assert.ok(created.data?.room?.code && created.data?.token, "room creation must return a room code and token");

  const read = await requestJson(baseUrl, `/rooms/${created.data.room.code}/state`, { roomToken: created.data.token });
  assert.equal(read.status, 200, `room read failed: ${JSON.stringify(read.data)}`);
  assert.equal(read.data?.code, created.data.room.code);
  assert.equal(read.data?.version, created.data.room.version);

  evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    evidenceKind: "isolated build-prune compiled API runtime acceptance with sequential HTTP and PGlite query",
    artifact: evidenceRelativePath,
    scratchSource: ["root package manifest and lockfile", "apps/api source, package, Prisma schema/config/migrations and generated client", "game-engine workspace", "shared workspace", "web package manifest and two API-imported helper modules"],
    runtime: { node: process.versions.node, npm: runVersion(npmCommand, scratchRoot), esbuild: "0.28.2" },
    commands: commandResults,
    build: {
      runtimeBundleEntry: "apps/api/dist/server.js",
      sourceApiTypeScriptBuild: "passed",
      runtimeBundleBytes: Buffer.byteLength(bundle),
      gameEnginePackageReferenceRemaining: /@abominations\/game-engine/.test(bundle),
      gameDomainErrorBundled: bundle.includes("GameDomainError"),
      runtimeStartScript: "npm --workspace @abominations/api run start",
    },
    prune: {
      command: "npm prune --omit=dev --omit=optional --omit=peer",
      filteredAuditFindings: audit.metadata?.vulnerabilities?.total ?? 0,
      removed: ["esbuild", "prisma", "@prisma/config", "deepmerge-ts", "mysql2", "@electric-sql/pglite"],
      retained: ["@prisma/client", "@prisma/adapter-pg", "pg", "ws", "dotenv"],
    },
    database: "in-memory PGlite over PostgreSQL wire protocol; checked-in migration SQL applied directly",
    migrationsApplied: migrations,
    api: {
      startUnderNode24: true,
      health: { status: 200, persistence: health.persistence },
      roomCreate: { status: created.status, code: created.data.room.code, version: created.data.room.version },
      roomRead: { status: read.status, code: read.data.code, version: read.data.version },
      sequentialDatabaseBackedCreateAndRead: true,
    },
    limits: [
      "PGlite is not PostgreSQL and this does not establish PostgreSQL MVCC, row locks, rollback, durability, or Prisma Migrate bookkeeping.",
      "API ran in development mode because the PGlite database uses loopback; production configuration validation was not exercised.",
      "No production host, deployment manifest, hosted network path, proxy upgrade, or final deployment artifact was tested.",
      "The API request path is sequential; concurrent transaction and multi-instance behavior are not established.",
    ],
    cleanup: { scratchTreeRemoved: !keepScratch, pgliteAndApiProcessesStopped: true },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  if (apiProcess) console.error(apiProcess.outputText?.() ?? "");
  console.error(`Scratch path: ${scratchRoot}`);
  process.exitCode = 1;
} finally {
  if (apiProcess) await stop(apiProcess);
  if (socketServer) await socketServer.stop();
  if (db) await db.close();
  if (!keepScratch) await rm(scratchRoot, { recursive: true, force: true });
}

function runVersion(command, cwd) {
  const result = spawnSync(command, ["--version"], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Could not read npm version: ${result.stderr}`);
  return result.stdout.trim();
}
