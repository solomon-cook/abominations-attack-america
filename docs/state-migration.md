# Persisted match-state migration policy

Match snapshots carry `schemaVersion` and immutable `boardId`, `boardVersion`, `boardContentHash`, and `rulesetVersion` pins.

The current schema version is `2`.

- Additive fields must have a deterministic runtime default when absent from an older schema-1 snapshot. Missing `eventLog` and `movedPieceIds` fields normalize to empty lists, and the typed `pendingDecision` is recomputed from the current phase, active player, battle queue, and winner. Room reads migrate a clone before projection, so reconnect and spectator views do not fail before the first post-upgrade command; the next successful mutation persists the normalized snapshot.
- Schema 1 development snapshots are migrated explicitly by `migrateGameState`: legacy location names are mapped through the versioned development board to canonical `HexKey` positions, stomp state is converted to hex keys, and the resulting snapshot is schema 2. Unknown names fail migration; they are never guessed as coordinates. The read projection keeps the stored snapshot unchanged until a successful command writes the migrated state.
- Completed setup is materialized before a room becomes active. New human and bot setup flows persist the prepared state with the final setup event at one revision. A legacy `WAITING` snapshot with completed but unapplied setup is migrated in the same transaction that changes it to `ACTIVE`. A legacy `ACTIVE` snapshot is repaired with a version compare-and-set only when the persisted event history contains no gameplay after the final setup event; otherwise it fails closed for manual recovery so an accepted action is never overwritten. These recovery cases are covered by the Prisma contract adapter, but still need live PostgreSQL concurrency evidence.
- Older development snapshots without `matchId`, stable `players`, or `nationalGuard` receive deterministic development identity defaults and an explicit neutral record-tile National Guard inventory. Production room creation must inject its own match identity; migration never uses wall-clock values.
- Existing fields are never silently reinterpreted. A snapshot with an unsupported schema version is rejected by `assertSupportedStateVersion` before rules execution.
- Every migrated or command-bound snapshot also passes structural inventory accounting: stable piece IDs, valid development/off-board positions, National Guard identity separation, battle references, and movement-ledger references. This does not assert unresolved physical quantities.
- Board and ruleset pins remain part of every snapshot; an in-progress match must continue to resolve against its pinned immutable definitions rather than the latest board catalogue.
- Any incompatible state change requires a new schema version, an explicit migration function and test fixture, and a deployment migration note before it can be accepted.

This policy does not fabricate unresolved production board or component facts. Those remain release blockers in `docs/unresolved-rules-inventory.md`.
