# Room lifecycle contract

The room stores expose explicit `disconnect` and `reconnect` transitions for a participant. A reconnect uses the current room token, so setup selections, the authoritative snapshot, and the room revision are preserved. Socket closure also writes the participant's disconnect timestamp; the four-minute server worker then gives a disconnected seat to the tactical bot until the next legal decision is reclaimed by its player.

| State | Transition | Current behavior |
| --- | --- | --- |
| waiting, `matchStarted=false` | players join | Players remain in a room-code waiting room. Any seated player can start once every seat is filled and connected. Setup actions are rejected until then. |
| waiting, `matchStarted=false` | player disconnects/reconnects | The room remains in its pre-match waiting room; readiness and setup actions remain unavailable. |
| waiting, `matchStarted=true` | setup/readiness | The lobby is closed and players complete setup; the room remains in the waiting status until the setup and readiness transition below. |
| active | one player disconnects | The match remains active for the remaining connected players. |
| active | every player disconnects | The room becomes abandoned. |
| abandoned | all ready players reconnect | The room becomes active again. |
| completed | disconnect/reconnect | The terminal state remains completed. |
| any non-terminal room | no activity for 24 hours | The room becomes expired and cannot be rejoined or resumed. |

The web client marks the participant disconnected when its WebSocket fails or closes, marks it reconnected when the socket is restored, and uses one guarded polling interval while the socket is unavailable. Each browser tab uses a session-scoped connection lease; a stale close from another tab cannot clear the newer lease. Commands remain revision-checked and action-idempotent across tabs. The Memory and Prisma stores implement the same status rules.

The first seated player is the room creator, but the start action does not grant them a special role. A creator departure follows the same presence rules as any other player; any remaining seated player can start when every seat is connected, and the room is not abandoned while another player remains connected.

The web client's **Leave room** action is a safe local exit: it attempts to mark the participant disconnected, clears the browser's stored session token, and returns to the lobby even if the network is already unavailable. It does not concede, delete, or mutate the match. Concede and rematch remain separate product decisions.

When setup is complete and every seat is ready, the stores apply the selected setup and advance the room revision with a matching `match.started` event. Prisma commits the prepared snapshot, new revision, and event in one transaction. The earlier host start action only closes the pre-match lobby and unlocks setup; the room's `matchStarted` field records that transition separately from its `waiting`/`active` status. Both Memory and Prisma return event deltas in chronological version order, including when a caller requests events after a known revision.

Prisma room reads inspect the newest retained event suffix before applying the requested event cursor. If the latest event revision differs from the snapshot or retained versions contain a gap, the API reports a redacted divergence metric and alert event once per room/revision while continuing to return the authoritative snapshot. This keeps pre-existing rooms readable while making their event-history gaps visible to operations.

The expiry window is an operational policy, not a game rule: `ROOM_IDLE_TIMEOUT_MS` is 24 hours, and meaningful room activity refreshes the deadline. Disconnect/reconnect does not bypass an expired room.

## Session and access policy

Guest access is bearer-token access: the room code identifies the room and the session token identifies the participant. Tokens are generated with 192 bits of random entropy and only their SHA-256 hashes are retained by the stores. WebSockets exchange this room token for a one-use ticket that expires after 30 seconds. A token never grants authority beyond its participant role, seat, current room status, and the authoritative revision/actor checks.

The current MVP policy is:

- A session is valid for 24 hours from creation or its most recent explicit rotation. A completed room remains readable only with a non-expired session, while an expired room or expired session rejects reads, reconnects, and gameplay.
- Disconnect has no short grace timer: the participant may reconnect during the room's 24-hour idle window. A room becomes abandoned only when every player is disconnected, and can recover when all ready players reconnect.
- There is no host privilege or token transfer between participants. Any connected seated player can start the pre-match room after all seats are connected. Verified accounts can link the current player seat; completed guest matches are not retroactively attached.
- Voluntary concession is the explicit inactive-player resolution; the client never converts a network failure into a concession.
- The API exposes `POST /rooms/:code/rotate-session`; the Prisma store replaces the stored hash, issues a replacement token, preserves the participant/role/seat, and rejects the old token. Account holders can resume a linked match from another device, replacing the prior room session.
- Room privacy is bearer-token based: possession of a player token permits that player's projection, while a spectator token permits only the redacted spectator projection. Public usernames may appear in participant views, but account email and credential data remain private. Room codes and tokens are never sufficient to bypass role or revision checks.

The release checklist must revisit audit delivery, automatic rotation, and external identity integration before production deployment; the current endpoint is an explicit guest-session primitive, not an identity provider.
