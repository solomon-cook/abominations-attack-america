# Persistence contract

Accepted commands are committed as one transaction containing:

1. the next room snapshot and revision;
2. the append-only event with its typed receipt;
3. the durable `CommandReceipt` row keyed by `(roomId, actionId)`.

The unique receipt key makes a retry after an API process restart return the already-accepted room state instead of applying the command again. The optimistic room-version predicate prevents two different commands from committing the same revision. A unique-key race is treated as an idempotent retry; any other transaction failure is surfaced and leaves the snapshot/event/receipt write set rolled back.

Setup assignments use the same room revision as gameplay commands: `POST /rooms/:code/setup` requires `expectedRevision`, applies the shared ordered/reverse setup state machine, persists the updated snapshot and `setup.updated` event, and rejects stale writes before applying them. The final human or bot setup action also persists `applyCompletedSetup` in that same revision; activation only changes lifecycle status, so gameplay cannot observe an active room with setup still unapplied.

Participant connectivity and room lifecycle transitions are defined in [the room lifecycle contract](room-lifecycle.md). Disconnect/reconnect does not alter the gameplay revision; it updates participant presence and can move an active room to `abandoned` when every player is disconnected. The Prisma `Participant.connectionId` lease is migrated with `20260825160000_add_connection_lease`.

The in-memory store remains a development fixture and cannot provide process-restart durability. Production restart/idempotency proof requires the Prisma/Postgres path and a database-backed integration test.

Room snapshots remain authoritative. The in-memory store keeps at most the newest 256 `RoomEvent` rows; Prisma limits each projection query to 256 matching `GameEvent` rows but does not prune persisted rows. `RoomView.eventsTruncated` is true when the requested `afterVersion` cursor is older than event history returned by that store. In Memory, the store tracks the highest event revision it pruned; in Prisma, the projection reads one extra matching row to detect whether more than 256 events matched. Exactly 256 matching events are returned with `eventsTruncated: false`. Both stores also append to the snapshot's game `eventLog` and `log`, and Prisma retains command receipts without a pruning path. When `eventsTruncated` is true, the included current snapshot remains authoritative; clients must not treat the returned event suffix as a complete history. A durable history and receipt-retention policy is a separate follow-up; the Prisma query limit is not a storage-retention guarantee.

The receipt schema is deployed by `apps/api/prisma/migrations/20260825130000_add_command_receipts/migration.sql`. `npm run prisma:validate`, `npm run prisma:generate`, and a migration diff check must pass before applying migrations to a configured database; no destructive reset or force-push is part of this change.

The engine persistence fixture also round-trips an encounter through JSON and `migrateGameState`, preserving Health, Infamy, Mutation history, stomped hexes, pending trophy choice, and permanent trophy removal. Reapplying the same trophy command to the reloaded snapshot produces byte-equivalent state and event history.
