# API reference

This is a concise description of the routes and transport behavior implemented by `apps/api/src/server.ts`, `apps/api/src/store.ts`, and `apps/api/src/prisma-store.ts`. Shared request and response types are in `packages/shared/src/index.ts` and `packages/game-engine/src/index.ts`.

The API defaults to `http://localhost:8787`; the WebSocket endpoint is `/ws`. Production startup requires an explicit `ALLOWED_ORIGIN` that is one HTTPS origin, plus a non-loopback Postgres URL. HTTP request bodies are JSON objects limited to 64 KiB; WebSocket messages have the same 64 KiB payload limit. `OPTIONS` requests to any path return 204 before request metrics and rate limiting. Documented routes match their listed path segments exactly; extra segments return 404. Known HTTP, validation, and domain errors retain their client status (domain/validation failures generally use 400, with explicit statuses such as 401 and 413), while unexpected internal or persistence errors return a generic 500 response. The public health failure body is generic; diagnostics stay in server-side reports. Unexpected WebSocket command failures also use a generic client message while expected command/domain failures retain their specific message. The `serverErrors` metric counts only 5xx HTTP responses. Rate limits use 429, and health/persistence failures use 503.

Rate limits are process-local fixed windows keyed by `request.socket.remoteAddress`; forwarded IP headers are ignored. Defaults are 120 non-`OPTIONS` HTTP requests per address per minute, 30 origin-approved WebSocket connection attempts per address per minute, and 120 WebSocket text messages per address per minute. Malformed or unsupported text messages count toward the WebSocket message limit; binary messages are rejected before counting. A supplied mismatched WebSocket `Origin` is rejected with HTTP 403 before the connection limiter and ticket consumption; raw rejected-origin upgrades need edge or proxy rate limiting if the API is exposed publicly. Development fixtures may raise these thresholds through `DEVELOPMENT_API_RATE_LIMIT`, `DEVELOPMENT_WS_RATE_LIMIT`, and `DEVELOPMENT_WS_COMMAND_RATE_LIMIT`. HTTP overages return 429 with `Retry-After: 60` and the normal CORS headers; over-limit origin-approved connections close the WebSocket with code 1013, and text-message overages return `protocol.error`. The limiter retains at most 4,096 active address buckets and fails closed for new addresses at capacity. These per-process controls require an edge or shared limiter policy when API instances scale out.

## HTTP routes

### Service and discovery

| Method and path | Access | Behavior |
| --- | --- | --- |
| `GET /health` | Public | Returns `{ ok: true, persistence: "memory" | "prisma" }` when the selected store is healthy. |
| `GET /metrics` | Public | Returns aggregate API counters. |
| `GET /rooms/public` | Public | Lists up to 20 recent public waiting/active rooms with counts; it does not return room state or participant identities. |
| `POST /rooms` | Public | Creates a room. JSON fields: `maxPlayers` (2–4; defaults to 4), `displayName` (defaults to `Player 1`), `privacy` (`private` when omitted, or `public`). An explicit privacy value other than `private` or `public` returns HTTP 400. Returns a `SessionResponse`. |

### Room access and gameplay

For room routes, `:code` is the room code. `:token` is not the room code: it is the participant's bearer token. The server checks `x-room-token` first, then a `token` query parameter. It also accepts a JSON `token` property only on body-handling routes that pass the parsed body to the token helper: `disconnect`, `reconnect`, `rotate-session`, `setup`, `ready`, and `actions`. The `claim` and `ws-ticket` routes do not read a body token. The current browser client sends the header for mutations and the query parameter for `GET /state`.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `POST /rooms/:code/join` | Public | Seats a player if a seat is available. JSON: `displayName`. Returns a `SessionResponse`. |
| `POST /rooms/:code/spectate` | Public | Adds a read-only spectator to a public room. JSON: `displayName`. Private rooms reject spectator entry. Returns a `SessionResponse`. |
| `POST /rooms/:code/claim` | Room token + account cookie | Rejects a supplied mismatched `Origin`, then links the token's player seat to the signed-in, verified account and rotates the room token. Spectator seats, completed rooms, expired rooms, and seats linked to a different account are rejected. Returns a `SessionResponse` with `accountLinked: true`. |
| `POST /rooms/:code/ws-ticket` | Room token | JSON: current tab's `connectionId` (or `null` only when no lease has been issued) and a client-generated UUID `requestedConnectionId`. Atomically installs that proposed lease, invalidates pending tickets/older sockets for the participant, and returns `{ ticket, connectionId }`. Repeating a request after a lost response with the same proposed ID and old expected ID returns a fresh ticket for the same lease while it remains disconnected. A different stale-tab proposal is rejected. Legacy callers may omit `requestedConnectionId`; the server then generates it. |
| `POST /rooms/:code/disconnect` | Room token | Marks the participant disconnected when the supplied `connectionId` is current. JSON: `connectionId`. |
| `POST /rooms/:code/reconnect` | Room token | JSON: current tab's `connectionId` and client-generated UUID `requestedConnectionId` for the replacement lease. A same-proposal retry after a lost response returns the same lease; stale current IDs and a different tab's proposal are rejected. Returns a `RoomView` with the replacement ID in an extra `connectionId` field. Legacy callers may omit `requestedConnectionId`; the server then generates it. |
| `POST /rooms/:code/rotate-session` | Room token | Replaces the bearer token, invalidating the old token and outstanding socket tickets. Returns a `SessionResponse`. |
| `POST /rooms/:code/ready` | Player room token | Changes a player's ready flag while the room is waiting. JSON must contain `ready: true` or `ready: false`; missing, `null`, string, and numeric values return HTTP 400 without changing readiness. |
| `POST /rooms/:code/setup` | Player room token | Applies one setup choice. JSON: `expectedRevision` and `action` (`SetupAction`). |
| `GET /rooms/:code/state?afterVersion=N` | Room token | Returns a full current `RoomView` projection and retained events with a version greater than `N`; `afterVersion` defaults to 0 only when absent, may be supplied at most once, and must be a non-negative safe integer, otherwise HTTP 400 is returned. The token may be supplied in the `token` query parameter. |
| `POST /rooms/:code/actions` | Player room token | Submits a gameplay command as `GameCommandEnvelope` in JSON field `envelope`. The legacy flattened form (`actionId`, `actorId`, `expectedRevision`, `protocolVersion`, `command`) is also accepted. HTTP and WebSocket share runtime validation for every `GameCommand` variant, required fields, known enums, optional field types, and `HexKey` syntax. Malformed commands return HTTP 400 or WebSocket `protocol.error` before store submission. Well-shaped but illegal actions continue to the engine's phase, ownership, and rule checks. |

`SessionResponse` contains the projected room, `participantId`, and the raw room token. The token is issued when the participant is created or explicitly rotated; the store retains its SHA-256 hash. Room tokens expire 24 hours after issuance or rotation. Reconnecting does not renew that expiry. A room code by itself does not grant room access.

### Accounts and public statistics

Account endpoints require Prisma/Postgres persistence. Account routes use the `aaa_account` cookie rather than a room token. The cookie is HttpOnly, SameSite=Lax, has a 30-day lifetime, and is marked Secure in production. Sign-in requires a verified email; password reset revokes the account's existing account sessions.

| Method and path | Access | Behavior |
| --- | --- | --- |
| `POST /accounts/register` | Public | JSON: `email`, `password` (12–128 characters). Creates an account and sends/returns a verification link as configured; it does not sign the account in. |
| `POST /accounts/login` | Public | JSON: `email`, `password`. Requires a verified email; sets the account cookie. |
| `POST /accounts/logout` | Optional account cookie | Revokes the current account session if present and clears the cookie; without a session, logout succeeds as a no-op. |
| `POST /accounts/verify-email` | Public | JSON: `token`. Consumes the one-use verification token and sets the account cookie. |
| `POST /accounts/resend-verification` | Public | JSON: `email`. Returns a generic message whether or not a pending account exists. |
| `POST /accounts/password-reset` | Public | JSON: `email`. Requests a reset link and returns a generic message. |
| `POST /accounts/password-reset/complete` | Public | JSON: `token`, `password`. Consumes the one-use reset token and revokes prior account sessions. |
| `GET /accounts/me` | Account cookie | Returns account ID, public username, and email-verification status. |
| `PATCH /accounts/me` | Account cookie | JSON: `username`; updates the public username. |
| `DELETE /accounts/me` | Account cookie | Deletes the account and anonymizes its linked room seats/results. |
| `GET /accounts/me/games` | Account cookie | Lists the account's non-fixture player seats and available result summary. |
| `GET /accounts/me/stats` | Account cookie | Returns aggregate player statistics. |
| `POST /accounts/me/games/:roomId/resume` | Account cookie | Issues a replacement room token for the account's linked player seat. `roomId` is the internal room ID returned in the account's games list, not the public room code. |
| `GET /players/:username` | Public | Returns public aggregate statistics and bot-assisted-match count; it does not return email. |
| `GET /leaderboard?category=...` | Public | Categories: `wins` (default when omitted), `win-rate`, `stomped-tiles`, `damage-taken`, `health-gained`, `luck`. Win rate requires five completed games; luck requires 20 recorded rolls. At most 100 entries are returned. |

In memory mode, account routes and `GET /players/:username` return 503; `GET /leaderboard` returns 200 with an empty list. Setting `PERSISTENCE=memory` selects the in-memory store even when a database URL is configured, so account routes, public profiles, account linking, and account-based room recovery are unavailable. Account linking and account-based room recovery require Prisma persistence.

Non-GET `/accounts/*` requests and `POST /rooms/:code/claim` reject a supplied `Origin` header unless it exactly matches the effective allowed web origin (`ALLOWED_ORIGIN`, or `http://localhost:5173` in development when unset; a literal development `*` also maps to that localhost origin), before parsing the body or calling account/persistence services. Requests without an `Origin` header remain available to non-browser clients. WebSocket handshakes enforce that same origin when an `Origin` header is present; handshakes without the header are allowed for non-browser clients. Browser requests include this header. CORS response headers alone are not treated as a CSRF control.

## WebSocket protocol and connection ownership

The client stores its current connection ID and a pending client-generated UUID proposal in tab-scoped session storage before calling `POST /rooms/:code/ws-ticket`. It sends both the current ID (or `null` before its first lease) and the pending `requestedConnectionId`, then connects to `/ws?code=:code&ticket=:ticket`. The proposal survives a reload and is reused after a lost HTTP response, allowing the server to issue a fresh ticket for the same disconnected lease. The server rejects a different stale proposal, rejects lease reuse while its socket is connected, and only activates a participant whose lease matches the ticket. Each ticket is one-use, expires after 30 seconds, and is bound to the participant's room session. A new issuance supersedes older unconsumed tickets and any delayed handshake for an older lease. `/reconnect` uses the same current-ID/proposed-ID retry contract. The 24-hour session expiry is checked at ticket consumption and connection, and on each socket action and private projection; after expiry, actions are rejected and no further private projection is sent. There is no expiry timer that proactively closes an otherwise idle socket. If a tab has lost its lease ID, the UI offers “Reset this connection,” which rotates the room token for that seat; other tabs sharing that session must reload to receive the replacement token. The server sends `room.updated` with the participant-specific projection on connection and broadcasts later room updates.

Client messages are JSON text:

```json
{
  "type": "command.submit",
  "envelope": {
    "actionId": "unique-action-id",
    "actorId": "participant-id",
    "expectedRevision": 12,
    "protocolVersion": 1,
    "command": { "type": "advance" }
  }
}
```

Server messages are `room.updated`, `command.accepted` (with only the action ID and resulting version), `command.rejected` (with the action ID and error), or `protocol.error`. An accepted command is followed by a lease-validated `room.updated` projection; the acknowledgement itself carries no room data. Binary, invalid JSON, and unsupported message types produce `protocol.error`. Spectators can connect and receive updates but cannot submit commands.

Each submitted message must contain a structurally valid `GameCommandEnvelope`, including a recognized command variant and the fields declared for that variant. Malformed command shapes produce `protocol.error` before the store is called; rule-illegal commands still use `command.rejected` after the engine evaluates the game state.

Each participant record has one current connection ID; the server's per-process socket registry associates local sockets with that ID and the room-session hash. Socket activation, commands, disconnects, and private projections check that the current lease ID and session hash match; Prisma uses compare-and-set when issuing/reclaiming a lease and rechecks after loading a projection. A local socket is closed when superseded by a ticket, reconnect, account claim/resume, or room-token rotation. Cross-process push revocation is not provided because there is no pub/sub fanout; another process rejects a stale socket on its next lease-validated projection or action, so immediate remote socket closure is not guaranteed. The lease check does not provide a distributed event-delivery barrier. See the [room lifecycle contract](room-lifecycle.md) for reconnect and bot takeover timing.

## Projections and privacy

Room reads and WebSocket broadcasts are projected for the authenticated participant's role and seat. A player receives their own card identifiers in the private card fields. Other players' private card fields are cleared; publicly face-up card identifiers are represented separately. Spectator projections have no private player hand. Mutation choices expose card identifiers only to the player who must choose. Client projections clear authoritative deck order and discard piles. Event details and payloads recursively remove fields named `cardId` and `mutationCardId`.

Participant metadata includes role, seat (for players), display name/public username where linked, readiness, connection state, and bot-control flags. Public room discovery is narrower and returns counts only.

## Revisions, receipts, and retained events

Game commands use `GameCommandEnvelope` from `packages/game-engine/src/index.ts`: `actionId`, `actorId`, `expectedRevision`, `protocolVersion`, and `command`. Protocol version is currently 1. Setup actions carry `expectedRevision` separately. The server checks player ownership/required decision, protocol version, and expected room revision before applying a legal game command. A stale revision or illegal command is rejected; clients should refresh the room snapshot and submit a new decision against its current revision.

An accepted gameplay command advances the room revision, records an event, and records its action ID. Reusing an action ID for the same room returns the current projected room without applying the command again. Prisma writes the snapshot, event, and durable `CommandReceipt` in one transaction. The in-memory store keeps receipt IDs only for the life of the process and loses all rooms on restart. Setup updates advance the room version and append `setup.updated` events; readiness and presence are not command receipts.

The memory store truncates its in-process `RoomEvent` list to 256 entries. Prisma limits each view query to 256 matching events, but the current store has no event-row pruning path, so persisted `GameEvent` rows are unbounded. `CommandReceipt` rows are also persisted without a store-level pruning path. In both stores, the snapshot's `state.eventLog` and human-readable `state.log` arrays are appended without a cap. A state read always includes the current snapshot and returns only events newer than `afterVersion`, up to the query limit; the response has no explicit history-gap marker, so the snapshot is the recovery boundary when an event range is missing. The Prisma query limit does not cap database storage.

## Presence, status, and persistence boundaries

New rooms start `waiting`; setup and readiness determine when a room can become `active`. An active room stays active while at least one player remains connected; it becomes `abandoned` when every player is disconnected. Once setup is complete, it can return to `active` when all ready seats are connected or under server-bot control. A disconnected seat becomes eligible for server-bot takeover after four minutes; the worker checks every five seconds, and reconnecting clears bot control while preserving already committed bot events. Room sessions expire 24 hours after issuance or rotation. The Memory store expires any noncompleted room after 24 hours without activity when an operation checks it. Prisma applies that idle expiry except to an `ACTIVE` room with at least one account-linked player. Rejoin, spectate, reconnect, and account resume reject an expired room; completed rooms are exempt. There is no separate room-expiry worker.

The status type includes `waiting`, `active`, `completed`, `abandoned`, and `expired`. The stores share the status vocabulary and abandonment behavior, but idle expiry differs: Memory expires every noncompleted idle room, while Prisma exempts active rooms with an account-linked player. The in-memory store is process-local and provides no restart durability; Prisma/Postgres persists rooms, participants, events, and command receipts, but live socket registries and broadcasts are process-local. Cross-instance real-time fanout/revocation is not provided by the current implementation.

Health reports the selected local store; it is not proof of a hosted deployment, production database, or multi-instance service. Production requirements and release evidence are tracked in [deployment requirements](deployment-requirements.md) and [release operations](release-operations.md).
