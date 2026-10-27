# Correspondence matches plan

**Status:** discovery only; no match-mode or deadline behavior is implemented.
**Roadmap source:** `TODO.md`, Milestone 15.

## User need and boundary

The roadmap asks for asynchronous/correspondence matches with explicit turn deadlines. The goal is to let players take turns on different schedules while preserving the same authoritative deterministic rules, canonical board, and room projections. This is an owner-requested roadmap need; it has not yet been validated with external players.

Existing live matches remain the default. The current four-minute disconnected-seat bot takeover, 24-hour inactive-room expiry, and guest room behavior must not silently change for live matches.

## Decisions required before implementation

- Turn duration and behavior at expiry (requested from the project owner).
- Whether correspondence requires linked accounts or can use the current guest bearer sessions.
- Whether reminders are in scope and, if so, their channel and consent requirements.
- Whether the match is private by default and which seat-recovery flows are supported across devices.

### Decision brief — proposed first release

These are recommendations for the project owner to accept or change; none is an implemented rule.

| Decision | Proposed default | Why it fits the first increment | Owner choice needed |
| --- | --- | --- | --- |
| Turn timer | Seven calendar days per turn, visible to both seats | Allows asynchronous play across ordinary work weeks while keeping the match moving | Confirm duration and whether expiry means a loss, a bot-controlled turn, or an expired match |
| Identity | Require linked accounts to create or accept correspondence matches; retain guest access for live rooms | Existing guest bearer sessions are browser-local and do not provide reliable cross-device seat recovery | Confirm account requirement or define another recovery mechanism |
| Reminders | No email or push reminders in the first increment; show due time and expiry in the room | Avoids introducing an unselected delivery provider, consent flow, and notification cost | Confirm no reminders, or select a channel and consent behavior |
| Privacy and recovery | Private by default; seat recovery requires signing in to the linked account | Limits discovery and gives a clear cross-device recovery identity | Confirm the privacy default and recovery model |

Implementation stays gated until the owner confirms or edits these choices. Existing live rooms retain their current timeout and disconnected-seat takeover behavior either way.

The engine must remain independent of wall-clock policy. Deadline state belongs to the room/service layer and must be revisioned, persisted, and visible in player and spectator projections without leaking private account data.

## Privacy, cost, and compatibility

- Keep room tokens, account credentials, and private email out of reminder payloads, public projections, logs, and URLs.
- Persist a deadline timestamp and process due turns with bounded, idempotent worker queries. Reminder delivery would add a separate external-service cost and consent surface; do not add it without an explicit decision.
- Deadline checks add database reads/writes and API worker time. The hosting provider and expected active-match volume are not selected, so numeric operating cost remains unknown and must be recorded before public rollout.
- Use additive schema changes and canonical room snapshots/events. Do not change deterministic game rules, live-room defaults, guest creation/join/spectate, or existing session authorization.

## Implementation gate

Before coding, settle the decisions above, add an explicit correspondence-mode contract and lifecycle transitions, then test deadline start/reset/expiry, reconnect and cross-device recovery, duplicate worker execution, simultaneous action-versus-expiry races, terminal outcomes, player/spectator projections, live-mode regression, and guest compatibility against both Memory and Prisma stores. External reminders and public rollout remain separate decisions.
