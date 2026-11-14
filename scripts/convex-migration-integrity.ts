type Row = Record<string, any>;

function assertUnique(rows: Row[], table: string, keyName: string, keyOf: (row: Row) => string | undefined) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined) continue;
    if (seen.has(key)) throw new Error(`Migration source violates uniqueness for ${table}.${keyName}.`);
    seen.add(key);
  }
}
function assertReferences(rows: Row[], table: string, field: string, target: Set<string>, optional = false) {
  for (const row of rows) {
    const value = row[field];
    if ((value === undefined || value === null) && optional) continue;
    if (typeof value !== "string" || !target.has(value)) {
      throw new Error(`Migration source has a missing ${table}.${field} relationship.`);
    }
  }
}

export function assertMigrationIntegrity(data: Map<string, Row[]>) {
  const rows = (name: string) => data.get(name) ?? [];
  const ids = (name: string) => new Set(rows(name).map((row) => row.externalId));
  const unique = (table: string, keyName: string, keyOf: (row: Row) => string | undefined) => assertUnique(rows(table), table, keyName, keyOf);

  for (const table of ["rooms", "participants", "events", "gameResults", "userAccounts", "accountSessions", "accountTokens", "friendInvitations", "friendInviteLinks", "friendships", "savedOpponents", "playerMatchStats"]) {
    unique(table, "externalId", (row) => row.externalId);
  }
  unique("rooms", "code", (row) => row.code);
  unique("participants", "tokenHash", (row) => row.tokenHash);
  unique("participants", "room/role/playerIndex", (row) => row.role === "player" && row.playerIndex != null ? `${row.roomId}/${row.role}/${row.playerIndex}` : undefined);
  unique("participants", "room/userId", (row) => row.userId ? `${row.roomId}/${row.userId}` : undefined);
  unique("events", "room/version", (row) => `${row.roomId}/${row.version}`);
  unique("commandReceipts", "room/actionId", (row) => `${row.roomId}/${row.actionId}`);
  unique("gameResults", "roomId", (row) => row.roomId);
  unique("userAccounts", "email", (row) => row.email);
  unique("userAccounts", "username", (row) => row.username);
  unique("accountSessions", "tokenHash", (row) => row.tokenHash);
  unique("accountTokens", "tokenHash", (row) => row.tokenHash);
  unique("friendInviteLinks", "tokenHash", (row) => row.tokenHash);
  unique("friendships", "userAId/userBId", (row) => `${row.userAId}/${row.userBId}`);
  unique("savedOpponents", "ownerId/opponentId", (row) => `${row.ownerId}/${row.opponentId}`);
  unique("playerMatchStats", "roomId/participantId", (row) => `${row.roomId}/${row.participantId}`);
  unique("errorReportAggregates", "bucketDate/category", (row) => `${row.bucketDate}/${row.category}`);

  const roomIds = ids("rooms");
  const participantIds = ids("participants");
  const accountIds = ids("userAccounts");
  assertReferences(rows("participants"), "participants", "roomId", roomIds);
  assertReferences(rows("participants"), "participants", "userId", accountIds, true);
  assertReferences(rows("events"), "events", "roomId", roomIds);
  assertReferences(rows("commandReceipts"), "commandReceipts", "roomId", roomIds);
  assertReferences(rows("gameResults"), "gameResults", "roomId", roomIds);
  assertReferences(rows("accountSessions"), "accountSessions", "userId", accountIds);
  assertReferences(rows("accountTokens"), "accountTokens", "userId", accountIds);
  for (const field of ["senderId", "recipientId"] as const) assertReferences(rows("friendInvitations"), "friendInvitations", field, accountIds);
  assertReferences(rows("friendInviteLinks"), "friendInviteLinks", "senderId", accountIds);
  for (const field of ["userAId", "userBId"] as const) assertReferences(rows("friendships"), "friendships", field, accountIds);
  for (const field of ["ownerId", "opponentId"] as const) assertReferences(rows("savedOpponents"), "savedOpponents", field, accountIds);
  assertReferences(rows("playerMatchStats"), "playerMatchStats", "roomId", roomIds);
  assertReferences(rows("playerMatchStats"), "playerMatchStats", "participantId", participantIds);
  assertReferences(rows("playerMatchStats"), "playerMatchStats", "userId", accountIds);
}
