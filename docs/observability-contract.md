# Observability contract

This document defines the credential-free operational surface provided by the
local API. It is a contract for a future deployment scraper, not evidence that
external dashboards or alert delivery are configured.

## Token-free metrics

`GET /metrics` returns a JSON object containing non-negative process counters.
The existing request, command, latency, reconnect, WebSocket, room-lifecycle,
and server-error counters are joined by:

| Counter | Meaning | Release use |
| --- | --- | --- |
| `errorReports` | Every redacted error report emitted by the API | Alert on unexpected error growth |
| `divergenceReports` | WebSocket projection refresh failures and Prisma reads where the latest event history does not match the snapshot revision or contains version gaps | Detect event/snapshot or access divergence |
| `deploymentFailures` | API listen failures | Detect failed process startup or binding |

The endpoint contains counters only. It must not expose room tokens, private
state, card payloads, or error messages. Responses are `no-store` and use the
same security headers as the health endpoint.

## Durable error aggregates

When Prisma persistence is configured, each report increments one UTC daily
counter by error category in `ErrorReportAggregate`. The durable row stores no
message, request path, room code, action ID, or user identifier. Reports are
retained for 90 days; older buckets are pruned during subsequent writes. The
write is asynchronous and never delays the API response. Failed aggregate
writes are logged without recursively creating another error report. This
provides durable counts, while `/metrics` remains process-local and resets on
restart. `npm run observability:postgres:verify`, when pointed at a disposable
Postgres database after migrations are applied, triggers API reports, verifies
the persisted count, restarts the API process, and confirms the count remains.

## Deployment boundary

The counters are process-local and reset on restart. A production deployment
must scrape them at an interval appropriate to the service, retain them in a
durable monitoring system, and alert on health failures, persistence failures,
divergence, deployment failures, command rejection spikes, latency, and
WebSocket failure rate. The read-only `npm run deployment:probe` command checks
that the health endpoint is backed by Prisma, PostgreSQL room-notification
fanout is ready, and every documented metric counter is numeric; it does not
create dashboards, configure alerts, or prove production availability.

If `ERROR_ALERT_URL` is configured, it must be an HTTPS URL without embedded
credentials. Persistence, event/snapshot divergence, and deployment reports
alert on the first occurrence; HTTP, command, and WebSocket reports alert after
five reports of that category in one minute. Each category is limited to one
alert per minute. Delivery is asynchronous, aborts after five seconds, and logs
failures without recursively reporting them. The outbound JSON contains only
the event name, category, timestamp, count, and threshold; it excludes the
report message, route, room code, action ID, and other request data. This
implements safe local delivery behavior when a destination is supplied; it
does not mean a production destination or external monitoring route is
configured.

The local integration test deliberately triggers one malformed request and
verifies that the corresponding error counter increments without exposing
private room data.
