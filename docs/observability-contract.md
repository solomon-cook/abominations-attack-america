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
| `divergenceReports` | WebSocket projection refreshes that could not be produced | Detect event/snapshot or access divergence |
| `deploymentFailures` | API listen failures | Detect failed process startup or binding |

The endpoint contains counters only. It must not expose room tokens, private
state, card payloads, or error messages. Responses are `no-store` and use the
same security headers as the health endpoint.

## Deployment boundary

The counters are process-local and reset on restart. A production deployment
must scrape them at an interval appropriate to the service, retain them in a
durable monitoring system, and alert on health failures, persistence failures,
divergence, deployment failures, command rejection spikes, latency, and
WebSocket failure rate. The read-only `npm run deployment:probe` command checks
that the health endpoint is backed by Prisma and that every documented metric
counter is numeric; it does not create dashboards, configure alerts, or prove
production availability.

The local integration test deliberately triggers one malformed request and
verifies that the corresponding error counter increments without exposing
private room data.
