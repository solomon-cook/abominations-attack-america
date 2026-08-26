# Release operations runbook

This runbook is the required process for a future staging or production deployment. It is documentation and a checklist; no live environment or backup drill is claimed by the repository.

The API handles `SIGTERM` and `SIGINT` by closing active WebSockets, draining the HTTP server, and disconnecting the Prisma client before exit. This protects the process boundary; it does not prove that durable rooms survive a managed-Postgres or host restart.

## Environment preparation

- Use separate web/API URLs, Postgres databases, `DATABASE_URL`, `ALLOWED_ORIGIN`, and alert destinations for development, staging, and production.
- Copy the non-secret variable names from `.env.example`; supply values through the deployment secret manager, never through Git.
- Keep Prisma migration credentials separate from the API runtime role. The runtime role needs only the tables and operations used by the application.
- Verify HTTPS/WSS, proxy WebSocket upgrades, bounded request bodies, distributed rate limiting, and log/metric collection before exposing the API.

## Persistence load probe

The bounded harness can exercise the Prisma adapter when a disposable Postgres
database is available: `DATABASE_URL=... npm run load:prisma:verify`. This mode
uses the development fixture only to exercise persistence, while retaining the
production board-validation gate for real production room creation. It covers
concurrent rooms, spectators, WebSocket/polling parity, commands, and bounded
reconnects; it is not a substitute for a sustained managed-service load test or
a process/host restart drill.

## Migration and rollback

1. Run `npm ci`, `npm run verify`, and `npm run prisma:validate` from the exact release commit.
2. Take a named Postgres backup before migration.
3. Apply migrations with `npm run prisma:migrate:deploy`.
4. Run `/health` and `/metrics` checks, then staging room create/join/ready/act/reconnect/spectate smoke tests.
5. Roll back the application only when the schema remains backward-compatible. For an incompatible migration, stop new rooms, preserve existing snapshots, restore the pre-migration backup in a separate database, and follow the incident decision rather than destructive ad-hoc SQL.

## Backup and restore drill

- Create a disposable staging room and record its snapshot, event versions, command receipts, and terminal result.
- Take a backup, make a known command, restore into a disposable database, and verify the snapshot, event history, receipt idempotency, and projection redaction.
- Record backup timestamp, migration version, restore duration, checksums, and operator approval.
- Do not declare recovery readiness until the drill has been run against the actual managed Postgres service.

## Incompatible matches

Every room snapshot pins schema version, board ID/version/hash, and ruleset version. A deployment must reject unsupported snapshots, keep old room data readable for the retention period, and prevent a new ruleset from silently continuing an incompatible match. The unresolved physical board and source-gated rules remain release blockers.

## Production smoke and evidence

Report these proof levels separately:

1. Source/data audit and human sign-off.
2. Engine/API tests and contract fixtures.
3. Web build and static accessibility/asset checks.
4. Deployed health, persistence, logs, metrics, and WebSocket checks.
5. Real browser create/join/play/reconnect/spectate and spectator privacy checks.

Only the first three levels have local evidence in the current repository.
