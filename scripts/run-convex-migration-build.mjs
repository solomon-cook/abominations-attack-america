import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const enabled = process.env.AAA_CONVEX_MIGRATION_RUN === "true";
if (!enabled) process.exit(0);
if (process.env.VERCEL_ENV !== "production") throw new Error("Convex data migration is restricted to a staged Vercel Production build.");
if (process.env.VERCEL !== "1") throw new Error("Convex data migration must run inside Vercel.");
if (!process.env.DIRECT_URL?.trim()) throw new Error("The staged build does not have the production database connection configured.");

const siteUrl = new URL(process.env.CONVEX_SITE_URL ?? "");
if (siteUrl.protocol !== "https:" || !siteUrl.hostname.endsWith(".convex.site")) {
  throw new Error("The Convex migration target must be an HTTPS Convex site URL.");
}
const token = process.env.CONVEX_MIGRATION_TOKEN ?? "";
if (token.length < 40) throw new Error("The one-time Convex migration token is missing or too short.");
const runId = process.env.AAA_CONVEX_MIGRATION_RUN_ID ?? "";
if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error("The Convex migration run ID is invalid.");

const root = resolve(process.cwd());
const outputRoot = await mkdtemp(join(tmpdir(), "aaa-convex-migration-"));
const tables = [
  "rooms", "participants", "events", "commandReceipts", "gameResults", "userAccounts",
  "accountSessions", "accountTokens", "friendInvitations", "friendInviteLinks", "friendships",
  "savedOpponents", "playerMatchStats", "errorReportAggregates",
];

async function post(path, payload) {
  let response;
  try {
    response = await fetch(new URL(`/internal/migration/${path}`, siteUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(`Convex migration request failed at ${path}.`);
  }
  let result;
  try { result = await response.json(); } catch { result = undefined; }
  if (!response.ok || !result || typeof result !== "object") {
    throw new Error(`Convex migration request failed at ${path} (HTTP ${response.status}).`);
  }
  return result;
}

async function flushBatch(table, batchNumber, rows) {
  const sha256 = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  await post("batch", { runId, table, batchNumber, sha256, rows });
}

try {
  const exportResult = spawnSync(process.execPath, ["--import", "tsx", "scripts/export-convex-migration.ts"], {
    cwd: root,
    env: { ...process.env, CONVEX_MIGRATION_OUTPUT_DIR: outputRoot },
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (exportResult.error || exportResult.status !== 0) {
    throw new Error("The production database snapshot could not be exported. Review the Vercel build status; no row data was written to build logs.");
  }

  const directories = (await readdir(outputRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  if (directories.length !== 1) throw new Error("The staged migration did not produce exactly one snapshot.");
  const snapshotDir = join(outputRoot, directories[0].name);
  const manifest = JSON.parse(await readFile(join(snapshotDir, "manifest.json"), "utf8"));
  const manifestTables = manifest?.tables;
  if (!manifestTables || Object.keys(manifestTables).length !== tables.length || tables.some((table) => !Number.isSafeInteger(manifestTables[table]?.count))) {
    throw new Error("The production snapshot manifest is incomplete.");
  }

  const begun = await post("begin", { runId, expectedCounts: Object.fromEntries(tables.map((table) => [table, manifestTables[table].count])) });
  if (begun.status === "completed") {
    console.log("Convex migration was already completed; the staged retry did not re-import rows.");
  } else {
    if (begun.status !== "started") throw new Error("Convex refused to start the migration.");

    for (const table of tables) {
      const contents = await readFile(join(snapshotDir, `${table}.jsonl`), "utf8");
      const digest = createHash("sha256").update(contents).digest("hex");
      if (digest !== manifestTables[table].sha256) throw new Error(`Snapshot integrity check failed for ${table}.`);
      const lines = contents.split("\n").filter(Boolean);
      if (lines.length !== manifestTables[table].count) throw new Error(`Snapshot row count check failed for ${table}.`);

      let batchRows = [];
      let batchBytes = 0;
      let batchNumber = 0;
      for (const line of lines) {
        const row = JSON.parse(line);
        const rowBytes = Buffer.byteLength(line);
        if (rowBytes > 1024 * 1024) throw new Error(`Snapshot has an oversized ${table} row.`);
        if (batchRows.length && (batchRows.length >= 400 || batchBytes + rowBytes > 3 * 1024 * 1024)) {
          await flushBatch(table, batchNumber++, batchRows);
          batchRows = [];
          batchBytes = 0;
        }
        batchRows.push(row);
        batchBytes += rowBytes;
      }
      if (batchRows.length) await flushBatch(table, batchNumber, batchRows);
    }

    const completed = await post("finish", { runId });
    if (completed.status !== "completed" || tables.some((table) => completed.importedCounts?.[table] !== manifestTables[table].count)) {
      throw new Error("Convex import counts did not match the production snapshot.");
    }
    console.log(`Convex migration imported and verified ${tables.length} tables: ${tables.map((table) => `${table}=${manifestTables[table].count}`).join(", ")}.`);
  }
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}
