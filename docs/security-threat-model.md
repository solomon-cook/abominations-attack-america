# Security threat model

This is the local security boundary for the guest-room and account-linked online MVP. It is a review checklist, not a production security sign-off.

| Asset or boundary | Threat | Current control | Remaining verification |
| --- | --- | --- | --- |
| Room codes | Guessing or enumerating active rooms | Six-character codes, explicit join/spectate routes, rate limits, no room listing endpoint | Edge/WAF policy, entropy review, abuse monitoring |
| Session tokens | Token theft or accidental disclosure | Tokens are sent in headers/query only as required by the current client, are hashed in stores, omitted from logs/errors, never projected to other viewers, expire after 24 hours, and are explicitly rotated by replacement | HTTPS, secure transport policy, browser storage review, audit delivery |
| Account credentials | Email or password/hash exposure, account enumeration, session theft | Passwords use salted scrypt hashes; account sessions are opaque, HttpOnly cookies; verification/reset links are one-use hashed tokens; room views and public profiles contain usernames only; account route logs are redacted | Configure transactional mail, apply distributed account rate limits, confirm cookie and origin settings at the selected host |
| Stale room control | Old sockets or bot workers issue commands after a seat is reclaimed | One-use 30-second WebSocket tickets bind to the current room session; connection leases are checked on each socket command; room version CAS and participant-row locks serialize bot actions against reconnect | Exercise multi-instance races against Postgres and proxy reconnect behaviour |
| Commands | Forged actor, out-of-turn action, replay, stale mutation | Participant/token/seat checks, expected revisions, protocol validation, action receipts, idempotent action IDs | Production multi-instance receipt behavior and incident testing |
| Hidden information | Opponent or spectator recovering deck order, discard contents, or internal owner arrays | Drawn card identities are public face up under rulebook p. 13, including event history and pending Toxicor choices; projections redact deck order, discard contents, and internal owner arrays while action authorization remains owner-only | Production review of event payloads, reconnect snapshots, and the full card visibility matrix |
| Random outcomes | Inferring future cards or rolls from a room snapshot or observed public rolls | Newly created non-fixture rooms use a cryptographically random 256-bit server-only key for ChaCha20 deck shuffles and game rolls; public projections replace the seed and cursor and omit the key | Legacy snapshots without a private key retain their original deterministic generator; production review must confirm private snapshot fields never enter logs, exports, or public event payloads |
| HTTP/WebSocket abuse | Burst traffic, handshake storms, slow or oversized requests, resource exhaustion | Separate process-local HTTP and WebSocket limiters, 64 KiB JSON body cap, 15 s request/keep-alive timeout, 20 s header timeout, production requires an explicit HTTPS `ALLOWED_ORIGIN`, security headers, token-free metrics | Distributed limiter and edge rate policy; verify timeout behaviour at the deployed proxy |
| Input injection | Malformed JSON or command data causing mutation or code execution | JSON boundary, typed command envelope, no dynamic evaluation, deterministic malformed-input tests | Deployed runtime hardening |
| Runtime dependencies | A vulnerable transitive package is exploitable through a tool or service boundary | `npm run security:dependencies:verify` passed on 2026-10-08 with zero production vulnerabilities; the baseline is empty, so newly reported advisories fail the gate | Rerun the dependency audit for each release and remediate any new findings |
| Static web content | Script injection, framing, MIME confusion, or unnecessary browser capabilities | Vercel applies CSP, HSTS, nosniff, frame denial, no-referrer, and disabled camera/geolocation/microphone via `apps/web/vercel.json`; a checked-in verifier locks the policy | Verify the deployed headers and browser behavior after the next authorized deploy; add the selected API origin to CSP if it is cross-origin |
| Persistence | Snapshot/event divergence, unauthorized database access, destructive recovery | Transactional Prisma persistence boundary, schema migrations, store contract tests | Least-privilege database role, backups, restore drill, divergence alerts |
| Secrets and operations | Leaked credentials or unobserved outage | Environment-based database/origin configuration, structured redacted logs, `/health`, `/metrics` | Secret manager, rotation, external alert routing, staging/production separation |

## Required production checks

- Use HTTPS/WSS and a single explicitly configured allowed origin.
- Put distributed rate limiting and request-size/time limits at the edge.
- Give the API a least-privilege database role; keep migration credentials separate.
- Test backup restore and Prisma migration rollback before serving live rooms.
- Room tokens are random bearer tokens with a 24-hour expiry and explicit replacement-token rotation. Account cookies are HttpOnly and Secure in production; keep web and API on a compatible site/origin and validate the configured mail sender before release.
- Alert on health failures, persistence exceptions, command rejection spikes, latency, WebSocket failure rate, and event/snapshot divergence.

The unresolved physical board, card effects, and Challenge rules are content/release blockers rather than security assumptions and must not be filled in by this document.
