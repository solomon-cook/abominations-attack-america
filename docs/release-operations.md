# Release operations runbook

This runbook is the required process for a future staging or production deployment. It is documentation and a checklist; no live environment or backup drill is claimed by the repository.

The provider-neutral evidence shape and hosting decision boundary are recorded in [`docs/release-evidence-schema.json`](release-evidence-schema.json) and [`docs/hosting-decision-record.md`](hosting-decision-record.md). Validate the schema and its explicitly empty template with `npm run release-evidence:verify`; this does not create or verify an environment.

The API handles `SIGTERM` and `SIGINT` by closing active WebSockets, draining the HTTP server, and disconnecting the Prisma client before exit. A migration-backed PostgreSQL trigger publishes committed room changes on `room_updated`; each Prisma-backed API process listens and refreshes its own viewer-specific WebSocket projections. If the listener disconnects, that process closes its sockets so clients refresh through the guarded polling path, while health reports realtime fanout as unavailable until the listener reconnects. This protects cross-process freshness during normal operation and listener recovery; it does not prove managed-service capacity or a host/database backup-and-restore drill.

## Environment preparation

- Use separate web/API URLs, Postgres databases, pooled runtime `DATABASE_URL`, direct migration/room-notification `DIRECT_URL`, `ALLOWED_ORIGIN`, and alert destinations for development, staging, and production. For a direct PostgreSQL service that does not use transaction pooling, `DIRECT_URL` may equal `DATABASE_URL`; Prisma Postgres requires the direct URL for migrations and `LISTEN/NOTIFY`.
- Copy the non-secret variable names from `.env.example`; supply values through the deployment secret manager, never through Git.
- Keep Prisma migration credentials separate from the API runtime role. The runtime role needs only the tables and operations used by the application.
- Verify HTTPS/WSS, proxy WebSocket upgrades, bounded request bodies, distributed rate limiting, and log/metric collection before exposing the API.

## Persistence load probe

The load harness exercises concurrent host and spectator sessions, WebSocket
and polling revision parity, commands, and reconnects. By default it creates
eight rooms, performs an initial reconnect pass, then runs ten seconds of
concurrent host/spectator polling and reconnects both sockets in every room
every fourth polling round. `LOAD_ROOMS`, `LOAD_DURATION_SECONDS`,
`LOAD_POLL_INTERVAL_MS`, and `LOAD_RECONNECT_EVERY_ROUNDS` bound the workload;
the harness fails on revision divergence or API/WebSocket errors. On
2026-10-08, `npm run load:development:verify` completed 39 sustained rounds,
624 state reads, and 144 additional reconnects across eight memory-backed
rooms with no reported failures.

A higher-concurrency repeat on 2026-10-08 sustained sixteen memory-backed rooms
for 30.1 seconds: 114 polling rounds, 3,648 state reads, and 896 additional
WebSocket reconnects completed without API or WebSocket failures. This extends
local in-process memory-store coverage; it does not establish Prisma, managed
Postgres, or multi-process concurrency.

The same bounded workload was rerun on 2026-10-10 with sixteen memory-backed
rooms and a 30-second duration. It completed 116 polling rounds, 3,712 state
reads, and 928 additional WebSocket reconnects without API or WebSocket
failures. This is a repeatable local memory-store result; the separate Prisma,
managed Postgres, multi-process, and restart/restore limits remain.

On 2026-10-10, the harness was raised to its configured maximum of 32
memory-backed rooms and run for 30 seconds. It completed 108 polling rounds,
6,912 state reads, and 1,728 additional WebSocket reconnects without API or
WebSocket failures. Its higher HTTP/WebSocket limits are set only in the
development child process so the harness's own rate limits do not throttle
this configured workload; production defaults are unchanged. This measures
one local in-memory API process only and does not establish persistence,
multi-process, managed-service capacity, or a release load limit.

The same harness can exercise the Prisma adapter when a disposable Postgres
database is available: `DATABASE_URL=... npm run load:prisma:verify`. This mode
uses the development fixture only to exercise persistence, while retaining the
production board-validation gate for real production room creation. The local
memory and disposable-database probes do not replace sustained managed-service
load, multi-process contention, or a process/host restart and restore drill.
An attempted Prisma load probe through `@electric-sql/pglite-socket` was not
reproducible: runs with two, four, and eight rooms returned PostgreSQL wire
protocol prepared-statement errors under concurrency. Those results are not
counted as application or capacity failures, nor as passing evidence.

With real PostgreSQL binaries installed, run
`POSTGRES_BIN_DIR=... npm run load:prisma:local:verify`. The script initializes a
temporary loopback-only cluster, applies all project migrations, runs the Prisma
load harness, then stops PostgreSQL and removes only its temporary data directory.
On 11 October 2026, local PostgreSQL 17 completed the maximum configured 32-room
run for 30 seconds: 82 host/spectator polling rounds, 5,248 state reads, and
1,280 additional WebSocket reconnects completed without API or WebSocket errors.
This verifies one local API process against a real PostgreSQL server; managed
service capacity remains a separate release gate.
An independent repeat from the current checkout with
`LOAD_ROOMS=32 LOAD_DURATION_SECONDS=30` completed 84 polling rounds, 5,376
state reads, and 1,344 additional WebSocket reconnects, again with no API or
WebSocket failures. Run counts vary with local scheduling; this repeat confirms
the bounded workload, not managed-service capacity or resilience under a
multi-process notification outage.
Prisma's local development Postgres server accepts one connection at a time
([official local-development documentation](https://docs.prisma.io/docs/postgres/database/local-development)), so it is useful for migrations and sequential persistence checks but cannot provide representative concurrent-connection acceptance. Run `load:prisma:verify` against an actual multi-connection Postgres service before claiming that gate.

`DATABASE_URL=... npm run persistence:postgres:verify` runs the API against a
disposable Postgres database with all project migrations applied. It creates a
two-player audited-board room, completes setup, readies both seats, resolves any
immediate giant placement, and accepts a legal gameplay command. After stopping
and restarting the API process, it verifies the persisted room revision and
snapshot, resubmits the same command envelope, and confirms the original action
receipt and single event are preserved. It also checks a cross-process
PostgreSQL WebSocket update and simultaneous duplicate-command retry. The
script intentionally leaves its test room in the database, so use a disposable
database. This is local process-restart and cross-process evidence; it does not
exercise a managed database failover, backup, or restore.

For a self-contained local run, use
`POSTGRES_BIN_DIR=... npm run persistence:postgres:local:verify`. This creates a
fresh loopback-only PostgreSQL cluster in a temporary directory, applies all
current project migrations, then runs the room restart/idempotency, account and
social route, persistent error-aggregate, and Prisma-backed victory-route
checks. It shuts down the server and removes only that temporary cluster. On
11 October 2026, PostgreSQL 17 passed all four checks: the audited-board room,
private RNG seed, snapshot, receipt, and single-event retry survived an API
restart; account defaults, privacy and social routes, concurrent invitation
acceptance, cascades, anonymized history, and guest room routes passed; two
error reports persisted across restart; and the 2-, 3-, and 4-player API routes
reached America Saved. Two independent API processes also verified that a
committed setup revision reaches a remote viewer-specific WebSocket projection
through PostgreSQL notification fanout, alongside the duplicate-command race.
This is local PostgreSQL evidence; it does not establish managed-service
migration, notification-outage soak, host restart, backup/restore, production
capacity, or human acceptance.

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
