# Room lifecycle contract

The room stores expose explicit `disconnect` and `reconnect` transitions for a participant. A reconnect uses the existing room token, so setup selections, the authoritative snapshot, and the room revision are preserved.

| State | Transition | Current behavior |
| --- | --- | --- |
| waiting | player disconnects/reconnects | The room remains waiting; readiness cannot be changed while disconnected. |
| active | one player disconnects | The match remains active for the remaining connected players. |
| active | every player disconnects | The room becomes abandoned. |
| abandoned | all ready players reconnect | The room becomes active again. |
| completed | disconnect/reconnect | The terminal state remains completed. |
| any non-terminal room | no activity for 24 hours | The room becomes expired and cannot be rejoined or resumed. |

The web client marks the participant disconnected when its WebSocket fails or closes, marks it reconnected when the socket is restored, and uses one guarded polling interval while the socket is unavailable. Each browser tab uses a session-scoped connection lease; a stale close from another tab cannot clear the newer lease. Commands remain revision-checked and action-idempotent across tabs. The Memory and Prisma stores implement the same status rules.

The first seated player is the room creator but is not a privileged host after creation. A creator departure follows the same presence rules as any other player; the room is not abandoned while another player remains connected, and no host transfer is required.

The web client's **Leave room** action is a safe local exit: it attempts to mark the participant disconnected, clears the browser's stored session token, and returns to the lobby even if the network is already unavailable. It does not concede, delete, or mutate the match. Concede and rematch remain separate product decisions.

The expiry window is an operational policy, not a game rule: `ROOM_IDLE_TIMEOUT_MS` is 24 hours, and meaningful room activity refreshes the deadline. Disconnect/reconnect does not bypass an expired room.

## Session and access policy

Guest access is bearer-token access: the room code identifies the room and the session token identifies the participant. Tokens are generated with 192 bits of random entropy and only their SHA-256 hashes are retained by the stores. A token never grants authority beyond its participant role, seat, current room status, and the authoritative revision/actor checks.

The current MVP policy is:

- A session remains valid only while its room is not expired; a completed room remains readable, while an expired room rejects reads, reconnects, and gameplay.
- Disconnect has no short grace timer: the participant may reconnect during the room's 24-hour idle window. A room becomes abandoned only when every player is disconnected, and can recover when all ready players reconnect.
- There is no host privilege and no token transfer between participants. A creator's departure therefore follows ordinary disconnect rules.
- Voluntary concession is the explicit inactive-player resolution; the client never converts a network failure into a concession.
- The API now exposes `POST /rooms/:code/rotate-session`; both stores atomically replace the stored hash, issue a replacement token, preserve the participant/role/seat, and reject the old token. Security-event/audit delivery and an authenticated automatic-rotation policy remain release requirements; neither token is exposed in projections or logs.
- Room privacy is bearer-token based in the current guest model: possession of a player token permits that player's projection, while a spectator token permits only the redacted spectator projection. Room codes and tokens are never sufficient to bypass role or revision checks.

The release checklist must revisit audit delivery, automatic rotation, and external identity integration before production deployment; the current endpoint is an explicit guest-session primitive, not an identity provider.
