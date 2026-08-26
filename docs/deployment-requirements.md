# Deployment requirements

This document records infrastructure requirements before a hosting provider is selected. It deliberately does not claim that a staging or production deployment exists.

## Required services

| Surface | Requirement | Current local evidence |
| --- | --- | --- |
| Web | Static asset delivery with SPA fallback, HTTPS, compressed JS/CSS/WebP, cache invalidation | Vite production build and optimized board assets pass locally |
| API | Durable compute for HTTP room commands, WebSocket broadcasts, polling fallback, bounded request bodies, structured logs | Node API server implements HTTP/WebSocket/polling paths locally |
| Database | Managed Postgres with Prisma migrations, transactions, backups, restore, least-privilege runtime credentials | Prisma schema/migrations and fake-adapter contract exist; no live production database is configured |
| Realtime | WSS support, idle connection limits, proxy upgrade support, reconnect-safe routing | Local WebSocket path and browser polling fallback exist; no hosted proxy has been verified |
| Secrets | Separate web/API environment values, database URL, allowed origin, and operational credentials | Local environment configuration is documented in code; `ERROR_ALERT_URL` is an optional redacted threshold-alert destination; secret manager and rotation remain outstanding |
| Observability | Health checks, token-free metrics, structured logs, external dashboards and alerts | `/health`, `/metrics`, and redacted operational logs exist locally |

## Environment separation

Staging and production must have separate URLs, databases, secrets, allowed origins, rate-limit policy, logs, and alert destinations. A deployment must not point a test build at production data or reuse production credentials in CI.

## Release safeguards

1. Run the complete `npm run verify` gate, including `npm run production-config:verify`; production configuration must select Prisma persistence and an explicit HTTPS origin, and must not point at a loopback database.
2. Apply and record Prisma migrations before application rollout.
3. Verify `/health`, `/metrics`, HTTP commands, WSS upgrade, polling fallback, and room expiry in staging.
4. Exercise backup restore and rollback using disposable data.
5. Run real browser create/join/play/reconnect/spectate smoke tests.
6. Promote only after board, rules, accessibility, content/IP, privacy, and security sign-offs are recorded.

The current repository is at the local foundation stage: no provider, staging URL, production URL, live Postgres instance, backup drill, or external alert sink is claimed here.

## Read-only deployment probe

Once a staging or production URL exists, run:

```sh
DEPLOYMENT_BASE_URL=https://api.example.test npm run deployment:probe
```

The probe performs no state-changing request. It requires HTTPS, checks that
`/health` reports `ok: true` with Prisma persistence, and validates that every
documented non-negative `/metrics` counter is numeric. For an intentional local
HTTP probe only, set `ALLOW_HTTP_DEPLOYMENT_PROBE=1`. A successful local build
or an unconfigured probe is not deployed-service evidence.
