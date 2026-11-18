import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { config as loadDotEnv } from "dotenv";

loadDotEnv({ path: resolve("apps/api/.env"), override: false });
loadDotEnv({ override: false });

type Row = Record<string, any>;
const tables = [
  "rooms", "participants", "events", "commandReceipts", "gameResults", "userAccounts",
  "accountSessions", "accountTokens", "friendInvitations", "friendInviteLinks", "friendships",
  "savedOpponents", "playerMatchStats", "errorReportAggregates",
] as const;

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label} in Convex backup.`);
  return value;
}

function date(value: unknown, label: string): Date {
  const result = new Date(requireNumber(value, label));
  if (!Number.isFinite(result.getTime())) throw new Error(`Invalid ${label} in Convex backup.`);
  return result;
}

function dateOnly(value: unknown, label: string): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid ${label} in Convex backup.`);
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error(`Invalid ${label} in Convex backup.`);
  return result;
}

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} document in Convex backup.`);
  return value as Row;
}

function requiredString(row: Row, field: string, table: string): string {
  if (typeof row[field] !== "string" || row[field].length === 0) throw new Error(`Missing ${table}.${field} in Convex backup.`);
  return row[field];
}

function state(value: unknown, label: string): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Row).$bytes === "string") {
    const compressed = Buffer.from((value as Row).$bytes, "base64");
    try { return JSON.parse(gunzipSync(compressed).toString("utf8")); }
    catch { throw new Error(`Could not decode compressed ${label} from Convex backup.`); }
  }
  return value;
}

async function readTable(root: string, table: string): Promise<Row[]> {
  const contents = await readFile(resolve(root, table, "documents.jsonl"), "utf8").catch(() => {
    throw new Error(`Missing ${table}/documents.jsonl. Pass the extracted Convex backup directory.`);
  });
  return contents.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return object(JSON.parse(line), `${table} line ${index + 1}`); }
    catch (error) { throw new Error(`Could not read ${table} line ${index + 1}: ${error instanceof Error ? error.message : "invalid JSON"}`); }
  });
}

function uniqueBy<T>(items: T[], key: (item: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    if (result.has(id)) throw new Error(`Duplicate ${label} ${id} in Convex backup.`);
    result.set(id, item);
  }
  return result;
}

function mapRows(docs: Record<(typeof tables)[number], Row[]> & { roomReplaySeeds?: Row[] }) {
  const seeds = uniqueBy(docs.roomReplaySeeds ?? [], (row) => requiredString(row, "roomId", "roomReplaySeeds"), "room replay seed");
  const users = docs.userAccounts.map((r) => ({ id: requiredString(r, "externalId", "userAccounts"), email: typeof r.email === "string" ? r.email : null, passwordHash: requiredString(r, "passwordHash", "userAccounts"), username: requiredString(r, "username", "userAccounts"), emailVerifiedAt: r.emailVerifiedAt == null ? null : date(r.emailVerifiedAt, "userAccounts.emailVerifiedAt"), publicStatsEnabled: Boolean(r.publicStatsEnabled), presenceEnabled: Boolean(r.presenceEnabled), presenceExpiresAt: r.presenceExpiresAt == null ? null : date(r.presenceExpiresAt, "userAccounts.presenceExpiresAt"), createdAt: date(r.createdAt, "userAccounts.createdAt"), updatedAt: date(r.updatedAt, "userAccounts.updatedAt") }));
  const rooms = docs.rooms.map((r) => {
    const id = requiredString(r, "externalId", "rooms");
    const seed = seeds.get(id);
    const initialReplayState = r.initialReplayState == null ? (seed ? state(seed.initialState, `room ${id} replay seed`) : undefined) : state(r.initialReplayState, `room ${id} initial replay state`);
    return { id, code: requiredString(r, "code", "rooms"), status: requiredString(r, "status", "rooms").toUpperCase() as any, matchStarted: Boolean(r.matchStarted), privacy: requiredString(r, "privacy", "rooms").toUpperCase() as any, isTest: Boolean(r.isTest), maxPlayers: requireNumber(r.maxPlayers, "rooms.maxPlayers"), version: requireNumber(r.version, "rooms.version"), state: state(r.state, `room ${id} state`) as any, ...(initialReplayState == null ? {} : { initialReplayState: initialReplayState as any }), createdAt: date(r.createdAt, "rooms.createdAt"), updatedAt: date(r.updatedAt, "rooms.updatedAt"), lastActivityAt: date(r.lastActivityAt, "rooms.lastActivityAt"), completedAt: r.completedAt == null ? null : date(r.completedAt, "rooms.completedAt"), playerStats: r.playerStats ?? [], viewerInviteTokenHash: r.viewerInviteTokenHash ?? null, viewerInviteExpiresAt: r.viewerInviteExpiresAt == null ? null : date(r.viewerInviteExpiresAt, "rooms.viewerInviteExpiresAt") };
  });
  const participants = docs.participants.map((r) => ({ id: requiredString(r, "externalId", "participants"), roomId: requiredString(r, "roomId", "participants"), displayName: requiredString(r, "displayName", "participants"), role: requiredString(r, "role", "participants").toUpperCase() as any, playerIndex: r.playerIndex ?? null, tokenHash: requiredString(r, "tokenHash", "participants"), sessionExpiresAt: date(r.sessionExpiresAt, "participants.sessionExpiresAt"), connectedAt: null, connectionId: null, ready: Boolean(r.ready), userId: r.userId ?? null, disconnectedAt: new Date(), botControlled: Boolean(r.botControlled), botAssisted: Boolean(r.botAssisted), createdAt: date(r.createdAt, "participants.createdAt") }));
  const events = docs.events.map((r) => ({ id: requiredString(r, "externalId", "events"), roomId: requiredString(r, "roomId", "events"), actionId: typeof r.payload?.receipt?.actionId === "string" ? r.payload.receipt.actionId : null, version: requireNumber(r.version, "events.version"), actorId: requiredString(r, "actorId", "events"), type: requiredString(r, "type", "events"), controlSource: requiredString(r, "controlSource", "events"), payload: r.payload ?? {}, ...(r.replayCommand == null ? {} : { replayCommand: r.replayCommand }), createdAt: date(r.createdAt, "events.createdAt") }));
  const commandReceipts = docs.commandReceipts.map((r) => ({ roomId: requiredString(r, "roomId", "commandReceipts"), actionId: requiredString(r, "actionId", "commandReceipts"), actorId: requiredString(r, "actorId", "commandReceipts"), version: requireNumber(r.version, "commandReceipts.version"), eventType: requiredString(r, "eventType", "commandReceipts"), createdAt: date(r.createdAt, "commandReceipts.createdAt") }));
  const gameResults = docs.gameResults.map((r) => ({ id: requiredString(r, "externalId", "gameResults"), roomId: requiredString(r, "roomId", "gameResults"), winnerId: r.winnerId ?? null, winnerName: r.winnerName ?? null, summary: r.summary ?? {}, createdAt: date(r.createdAt, "gameResults.createdAt") }));
  const accountSessions = docs.accountSessions.map((r) => ({ id: requiredString(r, "externalId", "accountSessions"), userId: requiredString(r, "userId", "accountSessions"), tokenHash: requiredString(r, "tokenHash", "accountSessions"), expiresAt: date(r.expiresAt, "accountSessions.expiresAt"), revokedAt: r.revokedAt == null ? null : date(r.revokedAt, "accountSessions.revokedAt"), createdAt: date(r.createdAt, "accountSessions.createdAt") }));
  const accountTokens = docs.accountTokens.map((r) => ({ id: requiredString(r, "externalId", "accountTokens"), userId: requiredString(r, "userId", "accountTokens"), tokenHash: requiredString(r, "tokenHash", "accountTokens"), purpose: requiredString(r, "purpose", "accountTokens") as any, expiresAt: date(r.expiresAt, "accountTokens.expiresAt"), consumedAt: r.consumedAt == null ? null : date(r.consumedAt, "accountTokens.consumedAt"), createdAt: date(r.createdAt, "accountTokens.createdAt") }));
  const friendInvitations = docs.friendInvitations.map((r) => ({ id: requiredString(r, "externalId", "friendInvitations"), senderId: requiredString(r, "senderId", "friendInvitations"), recipientId: requiredString(r, "recipientId", "friendInvitations"), expiresAt: date(r.expiresAt, "friendInvitations.expiresAt"), acceptedAt: r.acceptedAt == null ? null : date(r.acceptedAt, "friendInvitations.acceptedAt"), declinedAt: r.declinedAt == null ? null : date(r.declinedAt, "friendInvitations.declinedAt"), revokedAt: r.revokedAt == null ? null : date(r.revokedAt, "friendInvitations.revokedAt"), createdAt: date(r.createdAt, "friendInvitations.createdAt") }));
  const friendInviteLinks = docs.friendInviteLinks.map((r) => ({ id: requiredString(r, "externalId", "friendInviteLinks"), senderId: requiredString(r, "senderId", "friendInviteLinks"), tokenHash: requiredString(r, "tokenHash", "friendInviteLinks"), expiresAt: date(r.expiresAt, "friendInviteLinks.expiresAt"), acceptedAt: r.acceptedAt == null ? null : date(r.acceptedAt, "friendInviteLinks.acceptedAt"), revokedAt: r.revokedAt == null ? null : date(r.revokedAt, "friendInviteLinks.revokedAt"), createdAt: date(r.createdAt, "friendInviteLinks.createdAt") }));
  const friendships = docs.friendships.map((r) => ({ userAId: requiredString(r, "userAId", "friendships"), userBId: requiredString(r, "userBId", "friendships"), createdAt: date(r.createdAt, "friendships.createdAt") }));
  const savedOpponents = docs.savedOpponents.map((r) => ({ ownerId: requiredString(r, "ownerId", "savedOpponents"), opponentId: requiredString(r, "opponentId", "savedOpponents"), createdAt: date(r.createdAt, "savedOpponents.createdAt") }));
  const playerMatchStats = docs.playerMatchStats.map((r) => ({ id: requiredString(r, "externalId", "playerMatchStats"), roomId: requiredString(r, "roomId", "playerMatchStats"), participantId: requiredString(r, "participantId", "playerMatchStats"), userId: requiredString(r, "userId", "playerMatchStats"), playerIndex: requireNumber(r.playerIndex, "playerMatchStats.playerIndex"), username: requiredString(r, "username", "playerMatchStats"), outcome: requiredString(r, "outcome", "playerMatchStats"), monsterId: requiredString(r, "monsterId", "playerMatchStats"), monsterName: requiredString(r, "monsterName", "playerMatchStats"), branch: requiredString(r, "branch", "playerMatchStats"), stompedTiles: requireNumber(r.stompedTiles, "playerMatchStats.stompedTiles"), damageTaken: requireNumber(r.damageTaken, "playerMatchStats.damageTaken"), healthGained: requireNumber(r.healthGained, "playerMatchStats.healthGained"), luckTotal: requireNumber(r.luckTotal, "playerMatchStats.luckTotal"), luckRolls: requireNumber(r.luckRolls, "playerMatchStats.luckRolls"), botAssisted: Boolean(r.botAssisted), rounds: requireNumber(r.rounds, "playerMatchStats.rounds"), completedAt: date(r.completedAt, "playerMatchStats.completedAt") }));
  const errorReportAggregates = docs.errorReportAggregates.map((r) => ({ bucketDate: dateOnly(r.bucketDate, "errorReportAggregates.bucketDate"), category: requiredString(r, "category", "errorReportAggregates"), count: requireNumber(r.count, "errorReportAggregates.count"), updatedAt: date(r.updatedAt, "errorReportAggregates.updatedAt") }));
  const counts = { rooms: rooms.length, participants: participants.length, events: events.length, commandReceipts: commandReceipts.length, gameResults: gameResults.length, userAccounts: users.length, accountSessions: accountSessions.length, accountTokens: accountTokens.length, friendInvitations: friendInvitations.length, friendInviteLinks: friendInviteLinks.length, friendships: friendships.length, savedOpponents: savedOpponents.length, playerMatchStats: playerMatchStats.length, errorReportAggregates: errorReportAggregates.length };
  return { counts, rows: { rooms, participants, events, commandReceipts, gameResults, userAccounts: users, accountSessions, accountTokens, friendInvitations, friendInviteLinks, friendships, savedOpponents, playerMatchStats, errorReportAggregates } };
}

function assertUnique(rows: Row[], key: (row: Row) => string | undefined, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (value === undefined) continue;
    if (seen.has(value)) throw new Error(`Duplicate ${label} in Convex backup: ${value}.`);
    seen.add(value);
  }
}

function validateRows(rows: Record<string, Row[]>) {
  const rooms = new Set(rows.rooms.map((row) => row.id));
  const users = new Set(rows.userAccounts.map((row) => row.id));
  const participants = new Set(rows.participants.map((row) => row.id));
  assertUnique(rows.rooms, (row) => row.id, "room ID");
  assertUnique(rows.rooms, (row) => row.code, "room code");
  assertUnique(rows.commandReceipts, (row) => `${row.roomId}:${row.actionId}`, "room action receipt");
  assertUnique(rows.gameResults, (row) => row.id, "game result ID");
  assertUnique(rows.gameResults, (row) => row.roomId, "room game result");
  assertUnique(rows.participants, (row) => row.id, "participant ID");
  assertUnique(rows.participants, (row) => row.tokenHash, "participant token hash");
  assertUnique(rows.participants, (row) => row.playerIndex == null ? undefined : `${row.roomId}:${row.role}:${row.playerIndex}`, "room seat");
  assertUnique(rows.participants, (row) => row.userId == null ? undefined : `${row.roomId}:${row.userId}`, "room account link");
  assertUnique(rows.events, (row) => row.id, "event ID");
  assertUnique(rows.events, (row) => `${row.roomId}:${row.version}`, "room event version");
  assertUnique(rows.events, (row) => row.actionId == null ? undefined : `${row.roomId}:${row.actionId}`, "room action ID");
  assertUnique(rows.userAccounts, (row) => row.id, "account ID");
  assertUnique(rows.userAccounts, (row) => row.username, "username");
  assertUnique(rows.userAccounts, (row) => row.email ?? undefined, "account email");
  assertUnique(rows.accountSessions, (row) => row.id, "account session ID");
  assertUnique(rows.accountSessions, (row) => row.tokenHash, "account session token hash");
  assertUnique(rows.accountTokens, (row) => row.id, "account token ID");
  assertUnique(rows.accountTokens, (row) => row.tokenHash, "account token hash");
  assertUnique(rows.friendships, (row) => `${row.userAId}:${row.userBId}`, "friendship pair");
  assertUnique(rows.savedOpponents, (row) => `${row.ownerId}:${row.opponentId}`, "saved opponent pair");
  assertUnique(rows.playerMatchStats, (row) => row.id, "player match stat ID");
  assertUnique(rows.playerMatchStats, (row) => `${row.roomId}:${row.participantId}`, "room participant stat");
  assertUnique(rows.errorReportAggregates, (row) => `${row.bucketDate}:${row.category}`, "error report aggregate");
  const requireRef = (present: boolean, label: string) => { if (!present) throw new Error(`Broken ${label} reference in Convex backup.`); };
  for (const row of rows.rooms) {
    if (!row.state || typeof row.state !== "object" || Array.isArray(row.state)) throw new Error(`Invalid game state for room ${row.id} in Convex backup.`);
    if (!Number.isInteger(row.maxPlayers) || !Number.isInteger(row.version)) throw new Error(`Invalid room counters for ${row.id} in Convex backup.`);
  }
  for (const row of rows.participants) {
    if (row.playerIndex != null && !Number.isInteger(row.playerIndex)) throw new Error(`Invalid player seat for participant ${row.id} in Convex backup.`);
    if (row.role !== "PLAYER" && row.role !== "SPECTATOR") throw new Error(`Invalid role for participant ${row.id} in Convex backup.`);
  }
  for (const row of rows.participants) {
    requireRef(rooms.has(row.roomId), `participant ${row.id} room`);
    if (row.userId != null) requireRef(users.has(row.userId), `participant ${row.id} account`);
  }
  for (const row of [...rows.events, ...rows.commandReceipts, ...rows.gameResults]) requireRef(rooms.has(row.roomId), `room child ${row.roomId}`);
  for (const row of [...rows.accountSessions, ...rows.accountTokens]) requireRef(users.has(row.userId), `account child ${row.userId}`);
  for (const row of [...rows.friendInvitations, ...rows.friendInviteLinks]) requireRef(users.has(row.senderId), `friend sender ${row.senderId}`);
  for (const row of rows.friendInvitations) requireRef(users.has(row.recipientId), `friend recipient ${row.recipientId}`);
  for (const row of rows.friendships) requireRef(users.has(row.userAId) && users.has(row.userBId), "friendship account");
  for (const row of rows.savedOpponents) requireRef(users.has(row.ownerId) && users.has(row.opponentId), "saved opponent account");
  for (const row of rows.playerMatchStats) requireRef(rooms.has(row.roomId) && participants.has(row.participantId) && users.has(row.userId), "player match stat");
}

async function insertBatches(delegate: any, rows: Row[]) {
  for (let offset = 0; offset < rows.length; offset += 500) {
    await delegate.createMany({ data: rows.slice(offset, offset + 500) });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const input = args.find((arg) => arg !== "--check");
  if (!input || input.startsWith("-") || args.length !== (checkOnly ? 2 : 1)) throw new Error("Usage: npm run convex:import-prisma -- [--check] /path/to/extracted-convex-backup");
  const root = resolve(input);
  const raw = Object.fromEntries(await Promise.all([...tables, "roomReplaySeeds"].map(async (table) => [table, await readTable(root, table)]))) as Record<(typeof tables)[number] | "roomReplaySeeds", Row[]>;
  const mapped = mapRows(raw as Record<(typeof tables)[number], Row[]>);
  validateRows(mapped.rows);
  if (checkOnly) {
    console.log(`Convex backup is structurally valid: ${JSON.stringify(mapped.counts)}`);
    return;
  }
  const databaseUrl = process.env.DIRECT_URL?.trim() || process.env.PRISMA_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim() || process.env.DATABASE_URL_POOLED?.trim() || process.env.POSTGRES_URL?.trim();
  if (!databaseUrl) throw new Error("Set DIRECT_URL (preferred) or DATABASE_URL / PRISMA_DATABASE_URL before importing.");
  process.env.DATABASE_URL = databaseUrl;
  delete process.env.DATABASE_URL_POOLED;
  const { prisma } = await import("../apps/api/lib/prisma.js");
  if (!prisma) throw new Error("Could not initialize Prisma with the selected PostgreSQL database.");
  const delegates: Record<string, string> = { rooms: "gameRoom", participants: "participant", events: "gameEvent", commandReceipts: "commandReceipt", gameResults: "gameResult", userAccounts: "userAccount", accountSessions: "accountSession", accountTokens: "accountToken", friendInvitations: "friendInvitation", friendInviteLinks: "friendInviteLink", friendships: "friendship", savedOpponents: "savedOpponent", playerMatchStats: "playerMatchStat", errorReportAggregates: "errorReportAggregate" };
  try {
    await prisma.$transaction(async (tx: any) => {
      const existing = await Promise.all(Object.values(delegates).map((name) => tx[name].count()));
      const occupied = Object.entries(delegates).flatMap(([table], index) => existing[index] ? [`${table}=${existing[index]}`] : []);
      if (occupied.length) throw new Error(`Refusing import because the Prisma target is not empty (${occupied.join(", ")}).`);
      const rows = mapped.rows as Record<string, Row[]>;
      for (const table of ["userAccounts", "rooms", "participants", "events", "commandReceipts", "gameResults", "accountSessions", "accountTokens", "friendInvitations", "friendInviteLinks", "friendships", "savedOpponents", "playerMatchStats", "errorReportAggregates"]) {
        await insertBatches(tx[delegates[table]], rows[table]);
      }
    }, { isolationLevel: "Serializable", timeout: 600_000, maxWait: 30_000 });
    console.log(`Imported a consistent Convex backup into the empty Prisma target: ${JSON.stringify(mapped.counts)}`);
    console.log("Ephemeral room presence, runtime schedules, and WebSocket tickets were not imported; participants will reconnect.");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Convex backup import failed.");
  process.exitCode = 1;
});
