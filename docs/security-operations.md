# Security and abuse-control baseline

The API now applies a bounded in-memory request limiter to every HTTP request and a separate connection-attempt limiter to WebSockets. The defaults are 120 HTTP requests per source address per 60 seconds and 30 WebSocket handshakes per source address per 60 seconds. A rejected HTTP request returns `429` with `Retry-After: 60`; a rejected WebSocket closes with code `1013`. These are process-local controls, so production deployments still need an edge or shared limiter for multi-instance abuse resistance.

`GET /health` now probes the selected persistence boundary: memory reports its local boundary, while Prisma executes `SELECT 1`. A failed persistence probe returns `503` and emits a redacted persistence error report instead of claiming the service is healthy.

JSON responses set `no-store`, `nosniff`, `DENY` framing, and `no-referrer` headers. CORS uses `ALLOWED_ORIGIN` when configured and otherwise retains the development wildcard. Room tokens are not logged or included in error payloads. Rate-limit behavior is covered by deterministic unit tests in `apps/api/src/rate-limit.test.ts`.

Remaining release work includes a deployed reverse-proxy policy, shared/distributed limits, threat-model review, dependency and database permission review, backups, restore, and credential rotation. Those checks require a configured deployment and are intentionally not claimed by the local baseline.

Production dependency risk is checked by `npm run security:dependencies:verify`. It runs `npm audit --omit=dev` and compares the result with `config/production-audit-baseline.json`: the current baseline contains exactly three high-severity Prisma/deepmerge advisories. The command passes only to detect drift; it does not waive or remediate those known release blockers.

The API also exposes a token-free `/metrics` JSON snapshot with request failures, accepted/failed commands, latency sample totals, reconnects, WebSocket successes/failures, completed/abandoned rooms, and server errors. It additionally counts every redacted error report, WebSocket projection divergence report, and API deployment failure (`errorReports`, `divergenceReports`, and `deploymentFailures`) so a deployed scraper can alert on those categories without receiving private state. A bounded local error reporter redacts token-bearing paths, categorizes HTTP/command/WebSocket failures, and emits a threshold alert log event; it is still not a substitute for durable external metrics or alerting.
