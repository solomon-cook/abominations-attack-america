# Security threat model

This is the local security boundary for the current guest-room MVP foundation. It is a review checklist, not a production security sign-off.

| Asset or boundary | Threat | Current control | Remaining verification |
| --- | --- | --- | --- |
| Room codes | Guessing or enumerating active rooms | Six-character codes, explicit join/spectate routes, rate limits, no room listing endpoint | Edge/WAF policy, entropy review, abuse monitoring |
| Session tokens | Token theft or accidental disclosure | Tokens are sent in headers/query only as required by the current client, are hashed in stores, omitted from logs/errors, and never projected to other viewers | HTTPS, secure transport policy, expiry/rotation, browser storage review |
| Commands | Forged actor, out-of-turn action, replay, stale mutation | Participant/token/seat checks, expected revisions, protocol validation, action receipts, idempotent action IDs | Production multi-instance receipt behavior and incident testing |
| Hidden information | Opponent or spectator learning deck order/private cards | Player/spectator projections redact hands, deck order, discard order, event card identifiers | Full card visibility matrix after source effects are implemented |
| HTTP/WebSocket abuse | Burst traffic, handshake storms, resource exhaustion | Separate process-local HTTP and WebSocket limiters, security headers, token-free metrics | Distributed limiter and edge rate policy |
| Input injection | Malformed JSON or command data causing mutation or code execution | JSON boundary, typed command envelope, no dynamic evaluation, deterministic malformed-input tests | Dependency audit and deployed runtime hardening |
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
