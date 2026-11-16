import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const roomStatus = v.union(
  v.literal("waiting"), v.literal("active"), v.literal("completed"),
  v.literal("abandoned"), v.literal("expired"), v.literal("deleting"),
);
const privacy = v.union(v.literal("private"), v.literal("public"));

/**
 * Convex storage model. `externalId` preserves the current application's IDs
 * during import; all relationships use those stable IDs so imported histories
 * and browser room links do not depend on newly assigned Convex document IDs.
 */
export default defineSchema({
  rooms: defineTable({
    externalId: v.string(),
    code: v.string(),
    status: roomStatus,
    matchStarted: v.boolean(),
    privacy,
    isTest: v.boolean(),
    maxPlayers: v.number(),
    version: v.number(),
    state: v.any(),
    initialReplayState: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastActivityAt: v.number(),
    completedAt: v.optional(v.number()),
    botStepScheduled: v.optional(v.boolean()),
    botStepGeneration: v.optional(v.number()),
    presenceCheckScheduled: v.optional(v.boolean()),
    presenceCheckGeneration: v.optional(v.number()),
    presenceCheckId: v.optional(v.id("_scheduled_functions")),
    playerStats: v.any(),
    viewerInviteTokenHash: v.optional(v.string()),
    viewerInviteExpiresAt: v.optional(v.number()),
  })
    .index("by_external_id", ["externalId"])
    .index("by_code", ["code"])
    .index("by_privacy_activity", ["privacy", "lastActivityAt"])
    .index("by_privacy_status_activity", ["privacy", "status", "lastActivityAt"])
    .index("by_status_activity", ["status", "lastActivityAt"]),

  participants: defineTable({
    externalId: v.string(),
    roomId: v.string(),
    displayName: v.string(),
    role: v.union(v.literal("player"), v.literal("spectator")),
    playerIndex: v.optional(v.number()),
    tokenHash: v.string(),
    sessionExpiresAt: v.number(),
    connectedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    connectionId: v.optional(v.string()),
    ready: v.boolean(),
    userId: v.optional(v.string()),
    disconnectedAt: v.optional(v.number()),
    botControlled: v.boolean(),
    botAssisted: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_room", ["roomId"])
    .index("by_room_role", ["roomId", "role"])
    .index("by_room_player", ["roomId", "role", "playerIndex"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_role", ["userId", "role"])
    .index("by_user_role_created", ["userId", "role", "createdAt"])
    .index("by_room_user", ["roomId", "userId"])
    .index("by_bot_disconnected", ["botControlled", "disconnectedAt"])
    .index("by_presence", ["lastSeenAt"]),

  events: defineTable({
    externalId: v.string(),
    roomId: v.string(),
    version: v.number(),
    actorId: v.string(),
    type: v.string(),
    controlSource: v.union(v.literal("human"), v.literal("bot")),
    payload: v.any(),
    replayCommand: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_room_version", ["roomId", "version"])
    .index("by_room_created", ["roomId", "createdAt"]),

  commandReceipts: defineTable({
    roomId: v.string(),
    actionId: v.string(),
    actorId: v.string(),
    version: v.number(),
    eventType: v.string(),
    createdAt: v.number(),
  }).index("by_room_action", ["roomId", "actionId"]),

  gameResults: defineTable({
    externalId: v.string(),
    roomId: v.string(),
    winnerId: v.optional(v.string()),
    winnerName: v.optional(v.string()),
    summary: v.any(),
    createdAt: v.number(),
  }).index("by_room", ["roomId"]).index("by_winner_name", ["winnerName"]),

  userAccounts: defineTable({
    externalId: v.string(),
    email: v.optional(v.string()),
    passwordHash: v.string(),
    username: v.string(),
    emailVerifiedAt: v.optional(v.number()),
    publicStatsEnabled: v.boolean(),
    presenceEnabled: v.boolean(),
    presenceExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_email", ["email"])
    .index("by_username", ["username"])
    .index("by_presence", ["presenceEnabled", "presenceExpiresAt"]),

  accountSessions: defineTable({
    externalId: v.string(),
    userId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_expiry", ["userId", "expiresAt"]),

  accountTokens: defineTable({
    externalId: v.string(),
    userId: v.string(),
    tokenHash: v.string(),
    purpose: v.union(v.literal("EMAIL_VERIFICATION"), v.literal("PASSWORD_RESET")),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_purpose_expiry", ["userId", "purpose", "expiresAt"]),

  friendInvitations: defineTable({
    externalId: v.string(),
    senderId: v.string(),
    recipientId: v.string(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_recipient_state", ["recipientId", "acceptedAt", "declinedAt", "revokedAt", "expiresAt"])
    .index("by_sender_created", ["senderId", "createdAt"]),

  friendInviteLinks: defineTable({
    externalId: v.string(),
    senderId: v.string(),
    tokenHash: v.string(),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_sender_created", ["senderId", "createdAt"])
    .index("by_token_hash", ["tokenHash"])
    .index("by_expiry_state", ["expiresAt", "acceptedAt", "revokedAt"]),

  friendships: defineTable({
    externalId: v.string(),
    userAId: v.string(),
    userBId: v.string(),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_pair", ["userAId", "userBId"])
    .index("by_user_a_created", ["userAId", "createdAt"])
    .index("by_user_b_created", ["userBId", "createdAt"]),

  savedOpponents: defineTable({
    externalId: v.string(),
    ownerId: v.string(),
    opponentId: v.string(),
    createdAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_owner_opponent", ["ownerId", "opponentId"])
    .index("by_opponent", ["opponentId"]),

  playerMatchStats: defineTable({
    externalId: v.string(),
    roomId: v.string(),
    participantId: v.string(),
    userId: v.string(),
    playerIndex: v.number(),
    username: v.string(),
    outcome: v.string(),
    monsterId: v.string(),
    monsterName: v.string(),
    branch: v.string(),
    stompedTiles: v.number(),
    damageTaken: v.number(),
    healthGained: v.number(),
    luckTotal: v.number(),
    luckRolls: v.number(),
    botAssisted: v.boolean(),
    rounds: v.number(),
    completedAt: v.number(),
  })
    .index("by_external_id", ["externalId"])
    .index("by_room_participant", ["roomId", "participantId"])
    .index("by_user_completed", ["userId", "completedAt"])
    .index("by_outcome_completed", ["outcome", "completedAt"]),

  httpRateLimitBuckets: defineTable({
    keyHash: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
    expiresAt: v.number(),
    expiryJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_key", ["keyHash"])
    .index("by_expiry", ["expiresAt"]),

  errorReportAggregates: defineTable({
    bucketDate: v.string(),
    category: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_date_category", ["bucketDate", "category"]),

  migrationRuns: defineTable({
    runId: v.string(),
    status: v.union(v.literal("started"), v.literal("completed")),
    expectedCounts: v.any(),
    importedCounts: v.any(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_run_id", ["runId"]),

  migrationBatches: defineTable({
    runId: v.string(),
    table: v.string(),
    batchNumber: v.number(),
    rowCount: v.number(),
    sha256: v.string(),
    createdAt: v.number(),
  }).index("by_run_table_batch", ["runId", "table", "batchNumber"]),
});
