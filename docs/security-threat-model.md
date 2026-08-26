# Security threat model

This is the local security boundary for the current guest-room MVP foundation. It is a review checklist, not a production security sign-off.

| Asset or boundary | Threat | Current control | Remaining verification |
| --- | --- | --- | --- |
| Room codes | Guessing or enumerating active rooms | Six-character codes, explicit join/spectate routes, rate limits, no room listing endpoint | Edge/WAF policy, entropy review, abuse monitoring |
| Session tokens | Token theft or accidental disclosure | Tokens are sent in headers/query only as required by the current client, are hashed in stores, omitted from logs/errors, and never projected to other viewers | HTTPS, secure transport policy, expiry/rotation, browser storage review |
| Commands | Forged actor, out-of-turn action, replay, stale mutation | Participant/token/seat checks, expected revisions, protocol validation, action receipts, idempotent action IDs | Production multi-instance receipt behavior and incident testing |
| Hidden information | Opponent or spectator learning deck order/private cards | Player/spectator projections redact hands, deck order, discard order, event card identifiers | Full card visibility matrix after source effects are implemented |
| HTTP/WebSocket abuse | Burst traffic, handshake storms, slow or oversized requests, resource exhaustion | Separate process-local HTTP and WebSocket limiters, 64 KiB JSON body cap, 15 s request/keep-alive timeout, 20 s header timeout, production requires an explicit HTTPS `ALLOWED_ORIGIN`, security headers, token-free metrics | Distributed limiter and edge rate policy; verify timeout behaviour at the deployed proxy |
| Input injection | Malformed JSON or command data causing mutation or code execution | JSON boundary, typed command envelope, no dynamic evaluation, deterministic malformed-input tests | Dependency audit and deployed runtime hardening |
| Runtime dependencies | A vulnerable transitive package is exploitable through a tool or service boundary | `npm audit --omit=dev` was run on 2026-08-26 against 257 installed dependencies; it reports three high-severity entries (`@prisma/config@7.9.1`, `prisma@7.9.1`, and `deepmerge-ts@7.1.5`) through [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), whose affected range is `deepmerge-ts <8.0.0` | No safe non-breaking remediation is offered: npm proposes Prisma `6.12.0`, a semver-major change and downgrade from the installed Prisma 7 line. Do not run the automatic fix; test a supported Prisma/deepmerge upgrade or isolate Prisma tooling before release |
| Persistence | Snapshot/event divergence, unauthorized database access, destructive recovery | Transactional Prisma persistence boundary, schema migrations, store contract tests | Least-privilege database role, backups, restore drill, divergence alerts |
| Secrets and operations | Leaked credentials or unobserved outage | Environment-based database/origin configuration, structured redacted logs, `/health`, `/metrics` | Secret manager, rotation, external alert routing, staging/production separation |

## Required production checks

- Use HTTPS/WSS and a single explicitly configured allowed origin.
- Put distributed rate limiting and request-size/time limits at the edge.
- Give the API a least-privilege database role; keep migration credentials separate.
- Test backup restore and Prisma migration rollback before serving live rooms.
- Rotate room/session signing or encryption material if the implementation adds it; current guest tokens are random bearer tokens and still need expiry/rotation policy.
- Alert on health failures, persistence exceptions, command rejection spikes, latency, WebSocket failure rate, and event/snapshot divergence.

The unresolved physical board, card effects, and Challenge rules are content/release blockers rather than security assumptions and must not be filled in by this document.
