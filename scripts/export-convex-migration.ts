import { createHash } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";
import { assertMigrationIntegrity } from "./convex-migration-integrity.js";

loadDotEnv({ path: resolve("apps/api/.env"), override: false });
loadDotEnv({ override: false });

type Row = Record<string, any>;
const millis = (value: Date | null | undefined) => value == null ? undefined : value.getTime();
const external = (row: Row) => row.id;
const isoDate = (value: Date) => value.toISOString().slice(0, 10);


const tables: Array<{ name: string; load: (tx: any) => Promise<Row[]>; map: (row: Row) => Row }> = [
  { name: "rooms", load: (tx) => tx.gameRoom.findMany(), map: (r) => ({ externalId: external(r), code: r.code, status: r.status.toLowerCase(), matchStarted: Boolean(r.matchStarted), privacy: r.privacy.toLowerCase(), isTest: r.isTest, maxPlayers: r.maxPlayers, version: r.version, state: r.state, ...(r.initialReplayState == null ? {} : { initialReplayState: r.initialReplayState }), createdAt: millis(r.createdAt), updatedAt: millis(r.updatedAt), lastActivityAt: millis(r.lastActivityAt), ...(r.completedAt ? { completedAt: millis(r.completedAt) } : {}), playerStats: r.playerStats ?? [], ...(r.viewerInviteTokenHash ? { viewerInviteTokenHash: r.viewerInviteTokenHash } : {}), ...(r.viewerInviteExpiresAt ? { viewerInviteExpiresAt: millis(r.viewerInviteExpiresAt) } : {}) }) },
  { name: "participants", load: (tx) => tx.participant.findMany(), map: (r) => ({ externalId: external(r), roomId: r.roomId, displayName: r.displayName, role: r.role.toLowerCase(), ...(r.playerIndex == null ? {} : { playerIndex: r.playerIndex }), tokenHash: r.tokenHash, sessionExpiresAt: millis(r.sessionExpiresAt), ...(r.connectedAt ? { connectedAt: millis(r.connectedAt) } : {}), lastSeenAt: millis(r.connectedAt ?? r.disconnectedAt ?? r.createdAt), ...(r.connectionId ? { connectionId: r.connectionId } : {}), ready: r.ready, ...(r.userId ? { userId: r.userId } : {}), ...(r.disconnectedAt ? { disconnectedAt: millis(r.disconnectedAt) } : {}), botControlled: r.botControlled, botAssisted: r.botAssisted, createdAt: millis(r.createdAt) }) },
  { name: "events", load: (tx) => tx.gameEvent.findMany(), map: (r) => ({ externalId: external(r), roomId: r.roomId, version: r.version, actorId: r.actorId, type: r.type, controlSource: r.controlSource, payload: r.payload, ...(r.replayCommand == null ? {} : { replayCommand: r.replayCommand }), createdAt: millis(r.createdAt) }) },
  { name: "commandReceipts", load: (tx) => tx.commandReceipt.findMany(), map: (r) => ({ roomId: r.roomId, actionId: r.actionId, actorId: r.actorId, version: r.version, eventType: r.eventType, createdAt: millis(r.createdAt) }) },
  { name: "gameResults", load: (tx) => tx.gameResult.findMany(), map: (r) => ({ externalId: external(r), roomId: r.roomId, ...(r.winnerId ? { winnerId: r.winnerId } : {}), ...(r.winnerName ? { winnerName: r.winnerName } : {}), summary: r.summary, createdAt: millis(r.createdAt) }) },
  { name: "userAccounts", load: (tx) => tx.userAccount.findMany(), map: (r) => ({ externalId: external(r), email: r.email, passwordHash: r.passwordHash, username: r.username, ...(r.emailVerifiedAt ? { emailVerifiedAt: millis(r.emailVerifiedAt) } : {}), publicStatsEnabled: r.publicStatsEnabled, presenceEnabled: r.presenceEnabled, ...(r.presenceExpiresAt ? { presenceExpiresAt: millis(r.presenceExpiresAt) } : {}), createdAt: millis(r.createdAt), updatedAt: millis(r.updatedAt) }) },
  { name: "accountSessions", load: (tx) => tx.accountSession.findMany(), map: (r) => ({ externalId: external(r), userId: r.userId, tokenHash: r.tokenHash, expiresAt: millis(r.expiresAt), ...(r.revokedAt ? { revokedAt: millis(r.revokedAt) } : {}), createdAt: millis(r.createdAt) }) },
  { name: "accountTokens", load: (tx) => tx.accountToken.findMany(), map: (r) => ({ externalId: external(r), userId: r.userId, tokenHash: r.tokenHash, purpose: r.purpose, expiresAt: millis(r.expiresAt), ...(r.consumedAt ? { consumedAt: millis(r.consumedAt) } : {}), createdAt: millis(r.createdAt) }) },
  { name: "friendInvitations", load: (tx) => tx.friendInvitation.findMany(), map: (r) => ({ externalId: external(r), senderId: r.senderId, recipientId: r.recipientId, expiresAt: millis(r.expiresAt), ...(r.acceptedAt ? { acceptedAt: millis(r.acceptedAt) } : {}), ...(r.declinedAt ? { declinedAt: millis(r.declinedAt) } : {}), ...(r.revokedAt ? { revokedAt: millis(r.revokedAt) } : {}), createdAt: millis(r.createdAt) }) },
  { name: "friendInviteLinks", load: (tx) => tx.friendInviteLink.findMany(), map: (r) => ({ externalId: external(r), senderId: r.senderId, tokenHash: r.tokenHash, expiresAt: millis(r.expiresAt), ...(r.acceptedAt ? { acceptedAt: millis(r.acceptedAt) } : {}), ...(r.revokedAt ? { revokedAt: millis(r.revokedAt) } : {}), createdAt: millis(r.createdAt) }) },
  { name: "friendships", load: (tx) => tx.friendship.findMany(), map: (r) => ({ externalId: external(r), userAId: r.userAId, userBId: r.userBId, createdAt: millis(r.createdAt) }) },
  { name: "savedOpponents", load: (tx) => tx.savedOpponent.findMany(), map: (r) => ({ externalId: `${r.ownerId}:${r.opponentId}`, ownerId: r.ownerId, opponentId: r.opponentId, createdAt: millis(r.createdAt) }) },
  { name: "playerMatchStats", load: (tx) => tx.playerMatchStat.findMany(), map: (r) => ({ externalId: external(r), roomId: r.roomId, participantId: r.participantId, userId: r.userId, playerIndex: r.playerIndex, username: r.username, outcome: r.outcome, monsterId: r.monsterId, monsterName: r.monsterName, branch: r.branch, stompedTiles: r.stompedTiles, damageTaken: r.damageTaken, healthGained: r.healthGained, luckTotal: r.luckTotal, luckRolls: r.luckRolls, botAssisted: r.botAssisted, rounds: r.rounds, completedAt: millis(r.completedAt) }) },
  { name: "errorReportAggregates", load: (tx) => tx.errorReportAggregate.findMany(), map: (r) => ({ bucketDate: isoDate(r.bucketDate), category: r.category, count: r.count, updatedAt: millis(r.updatedAt) }) },
];

async function main() {
  const sourceUrl = process.env.DIRECT_URL?.trim()
    || process.env.PRISMA_DATABASE_URL?.trim()
    || process.env.DATABASE_URL?.trim()
    || process.env.DATABASE_URL_POOLED?.trim()
    || process.env.POSTGRES_URL?.trim();
  if (!sourceUrl) throw new Error("Set DIRECT_URL (preferred) or DATABASE_URL / PRISMA_DATABASE_URL / DATABASE_URL_POOLED / POSTGRES_URL before exporting the migration.");
  // Use the direct migration connection when the runtime also has a pooled URL.
  process.env.DATABASE_URL = sourceUrl;
  delete process.env.DATABASE_URL_POOLED;
  const { prisma } = await import("../apps/api/lib/prisma.js");
  if (!prisma) throw new Error("Could not initialize Prisma with the selected PostgreSQL source.");
  try {
    const rowsByTable = await prisma.$transaction(async (tx: any) => {
      const output = new Map<string, Row[]>();
      for (const table of tables) output.set(table.name, (await table.load(tx)).map(table.map));
      return output;
    }, { isolationLevel: "RepeatableRead", timeout: 600_000, maxWait: 30_000 });
    assertMigrationIntegrity(rowsByTable);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputRoot = resolve(process.env.CONVEX_MIGRATION_OUTPUT_DIR?.trim() || ".data");
    const outDir = resolve(outputRoot, `convex-migration-${stamp}`);
    if (!outDir.startsWith(`${outputRoot}/`)) throw new Error("Invalid migration output directory.");
    await mkdir(outputRoot, { recursive: true, mode: 0o700 });
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    await chmod(outDir, 0o700);
    const manifest: Row = { createdAt: new Date().toISOString(), consistency: "PostgreSQL repeatable-read transaction", tables: {}, excluded: ["websocketTickets (ephemeral tickets are invalidated at cutover; clients reconnect through Convex subscriptions)", "httpRateLimitBuckets (ephemeral per-address throttling state)"] };
    for (const table of tables) {
      const rows = rowsByTable.get(table.name)!;
      const lines = rows.map((row) => `${JSON.stringify(row)}\n`);
      for (const line of lines) if (Buffer.byteLength(line) > 1024 * 1024) throw new Error(`${table.name} contains a row larger than Convex's 1 MiB document limit.`);
      const contents = lines.join("");
      const path = resolve(outDir, `${table.name}.jsonl`);
      await writeFile(path, contents, { mode: 0o600 });
      await chmod(path, 0o600);
      manifest.tables[table.name] = { count: rows.length, sha256: createHash("sha256").update(contents).digest("hex"), bytes: Buffer.byteLength(contents) };
    }
    const commands = tables.map(({ name }) => `npx convex import --deployment "$CONVEX_DEPLOYMENT" --table ${name} "${outDir}/${name}.jsonl"`).join("\n");
    await writeFile(resolve(outDir, "import-commands.sh"), `#!/bin/sh\nset -eu\n: "${"${CONVEX_DEPLOYMENT:?Set CONVEX_DEPLOYMENT to the intended empty development migration target}"}"\ncase "$CONVEX_DEPLOYMENT" in dev|dev:*|local) ;; *) echo "Refusing import: select a Convex dev or local deployment." >&2; exit 2;; esac\n${commands}\n`, { mode: 0o700 });
    await writeFile(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`Exported ${tables.length} tables to ${outDir}`);
    console.log(`Manifest: ${resolve(outDir, "manifest.json")}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Convex migration export failed.");
  process.exitCode = 1;
});
