# Persisted match-state migration policy

Match snapshots carry `schemaVersion` and immutable `boardId`, `boardVersion`, `boardContentHash`, and `rulesetVersion` pins.

The current schema version is `2`.

- Additive fields must have a deterministic runtime default when absent from an older schema-1 snapshot. The engine normalizes missing `eventLog` and `movedPieceIds` fields to empty lists before applying commands, and recomputes the typed `pendingDecision` from the current phase, active player, battle queue, and winner; new mutations write them back so refreshed snapshots are self-healing.
- Schema 1 development snapshots are migrated explicitly by `migrateGameState`: legacy location names are mapped through the versioned development board to canonical `HexKey` positions, stomp state is converted to hex keys, and the resulting snapshot is schema 2. Unknown names fail migration; they are never guessed as coordinates.
- Older development snapshots without `matchId`, stable `players`, or `nationalGuard` receive deterministic development identity defaults and an explicit neutral record-tile National Guard inventory. Production room creation must inject its own match identity; migration never uses wall-clock values.
- Existing fields are never silently reinterpreted. A snapshot with an unsupported schema version is rejected by `assertSupportedStateVersion` before rules execution.
- Every migrated or command-bound snapshot also passes structural inventory accounting: stable piece IDs, valid development/off-board positions, National Guard identity separation, battle references, and movement-ledger references. This does not assert unresolved physical quantities.
- Board and ruleset pins remain part of every snapshot; an in-progress match must continue to resolve against its pinned immutable definitions rather than the latest board catalogue.
- Any incompatible state change requires a new schema version, an explicit migration function and test fixture, and a deployment migration note before it can be accepted.

This policy does not fabricate unresolved production board or component facts. Those remain release blockers in `docs/unresolved-rules-inventory.md`.
