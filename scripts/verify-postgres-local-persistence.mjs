import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
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

function run(command, args, { cwd, env = process.env, timeoutMs = 180_000, input } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    if (input !== undefined) child.stdin.end(input);
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

const prismaCli = createRequire(resolve(apiRoot, "package.json")).resolve("prisma/build/index.js");
const workspace = await mkdtemp(join(tmpdir(), "abominations-prisma-persistence-"));
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
  API_VICTORY_ROUTE_PERSISTENCE: "prisma",
};
let runtimeDatabaseUrl;

async function runCheck(label, args, { timeoutMs = 300_000 } = {}) {
  const result = await run(process.execPath, args, { cwd: root, env: environment, timeoutMs });
  let output = `${result.stdout}${result.stderr}`.replaceAll(databaseUrl, "[temporary migration DATABASE_URL]");
  if (runtimeDatabaseUrl) output = output.replaceAll(runtimeDatabaseUrl, "[temporary restricted runtime DATABASE_URL]");
  assert.equal(result.code, 0, `${label} failed:\n${output}`);
  process.stdout.write(output);
}

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

  const runtimeRole = `abom_runtime_${process.pid}`;
  const runtimePassword = randomBytes(32).toString("base64url");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
  const runtimeRoleSql = [
    `CREATE ROLE ${quoteIdentifier(runtimeRole)} LOGIN PASSWORD '${runtimePassword}';`,
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(runtimeRole)};`,
    `GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(runtimeRole)};`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(runtimeRole)};`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(runtimeRole)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(username)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdentifier(runtimeRole)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdentifier(username)} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quoteIdentifier(runtimeRole)};`,
    `CREATE TABLE public.runtime_role_acl_probe (id integer PRIMARY KEY, marker text NOT NULL);`,
    `INSERT INTO public.runtime_role_acl_probe (id, marker) VALUES (1, 'migration-role-created-table');`,
  ].join("\n");
  const roleProvision = await run(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", databaseUrl], { cwd: root, env: environment, input: runtimeRoleSql });
  assert.equal(roleProvision.code, 0, `Least-privilege PostgreSQL runtime role setup failed:\n${roleProvision.stdout}\n${roleProvision.stderr}`);

  const runtimeUrl = new URL(databaseUrl);
  runtimeUrl.username = runtimeRole;
  runtimeUrl.password = runtimePassword;
  runtimeDatabaseUrl = runtimeUrl.href;
  const runtimeEnvironment = { ...environment, DATABASE_URL: runtimeDatabaseUrl };
  const roleFlags = await run(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--dbname", runtimeDatabaseUrl, "--command", "SELECT current_user || '|' || rolsuper || '|' || rolcreatedb || '|' || rolcreaterole || '|' || rolreplication FROM pg_roles WHERE rolname = current_user"], { cwd: root, env: runtimeEnvironment });
  assert.equal(roleFlags.code, 0, `Could not inspect restricted PostgreSQL runtime role:\n${roleFlags.stdout}\n${roleFlags.stderr}`);
  assert.equal(roleFlags.stdout.trim(), `${runtimeRole}|false|false|false|false`, "runtime role is not a superuser, database creator, role creator, or replication role");
  const ddlAttempt = await run(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", runtimeDatabaseUrl, "--command", "CREATE TABLE public.runtime_role_must_not_create (id integer)"], { cwd: root, env: runtimeEnvironment });
  assert.notEqual(ddlAttempt.code, 0, "runtime role cannot create schema objects");
  assert.match(ddlAttempt.stderr, /permission denied for schema public/i, "runtime DDL rejection comes from PostgreSQL schema privileges");
  const crudProbe = await run(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", runtimeDatabaseUrl, "--command", "BEGIN; SELECT marker FROM public.runtime_role_acl_probe WHERE id = 1; INSERT INTO public.runtime_role_acl_probe (id, marker) VALUES (2, 'runtime-crud'); UPDATE public.runtime_role_acl_probe SET marker = 'runtime-updated' WHERE id = 2; DELETE FROM public.runtime_role_acl_probe WHERE id = 2; ROLLBACK"], { cwd: root, env: runtimeEnvironment });
  assert.equal(crudProbe.code, 0, `Runtime CRUD privileges do not support the application data path:\n${crudProbe.stdout}\n${crudProbe.stderr}`);
  const dropProbe = await run(psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--dbname", databaseUrl, "--command", "DROP TABLE public.runtime_role_acl_probe"], { cwd: root, env: environment });
  assert.equal(dropProbe.code, 0, `Could not remove PostgreSQL runtime-role probe table:\n${dropProbe.stdout}\n${dropProbe.stderr}`);

  environment.DATABASE_URL = runtimeDatabaseUrl;
  console.log("Temporary PostgreSQL runtime role is restricted from schema DDL and verified for application CRUD; all following persistence checks run under that role.");

  await runCheck("Prisma/PostgreSQL room restart and idempotency", ["--import", "tsx", "scripts/verify-postgres-room-durability.mjs"]);
  await runCheck("Prisma/PostgreSQL account and social routes", ["--import", "tsx", "scripts/verify-postgres-account-routes.mjs"]);
  await runCheck("Prisma/PostgreSQL persistent error aggregates", ["--import", "tsx", "scripts/verify-postgres-error-aggregate.mjs"]);
  await runCheck("Prisma/PostgreSQL victory routes", [
    "--import", "tsx", "--test", "--test-name-pattern=API room can reach America Saved through legal room actions",
    "apps/api/src/server.integration.test.ts",
  ]);

  console.log("Local PostgreSQL persistence checks passed against a fresh temporary cluster, including restricted runtime-role CRUD and two-process WebSocket fanout; managed-host capacity/resilience and backup/restore remain separate release gates.");
} finally {
  if (postgresStarted) {
    const stopped = await run(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "stop"]);
    if (stopped.code !== 0) process.stderr.write(`Temporary PostgreSQL shutdown failed:\n${stopped.stdout}\n${stopped.stderr}`);
  }
  await rm(workspace, { recursive: true, force: true });
}
