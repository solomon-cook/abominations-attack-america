# Room lifecycle contract

The room stores expose explicit `disconnect` and `reconnect` transitions for a participant. A reconnect uses the current room token, so setup selections, the authoritative snapshot, and the room revision are preserved. Socket closure also writes the participant's disconnect timestamp; the four-minute server worker then gives a disconnected seat to the tactical bot until the next legal decision is reclaimed by its player.

| State | Transition | Current behavior |
| --- | --- | --- |
| waiting | player disconnects/reconnects | The room remains waiting; readiness cannot be changed while disconnected. |
| active | one player disconnects | The match remains active for the remaining connected players. |
| active | every player disconnects | The room becomes abandoned. |
| abandoned | all ready players reconnect or are under server-bot control | The room becomes active again after setup is complete. |
| completed | disconnect/reconnect | The terminal state remains completed. |
| any non-terminal room | no activity for 24 hours | The room becomes expired and cannot be rejoined or resumed. |

The web client marks the participant disconnected when its WebSocket fails or closes, marks it reconnected when the socket is restored, and uses one guarded polling interval while the socket is unavailable. Each browser tab uses a session-scoped connection lease; a stale close from another tab cannot clear the newer lease. Commands remain revision-checked and action-idempotent across tabs. One compatibility exception remains: Prisma preserves its established idle-expiry exemption for an `ACTIVE` room with at least one account-linked `PLAYER`; Memory expires idle non-completed rooms uniformly. `ABANDONED` rooms are not exempt in Prisma. This store difference is documented in [the backend audit](backend-audit.md) and is not a rules decision.

The first seated player is the room creator but is not a privileged host after creation. A creator departure follows the same presence rules as any other player; the room is not abandoned while another player remains connected, and no host transfer is required.

The web client's **Leave room** action is a safe local exit: it attempts to mark the participant disconnected, clears the browser's stored session token, and returns to the lobby even if the network is already unavailable. It does not concede, delete, or mutate the match. Concede and rematch remain separate product decisions.

Completed setup is materialized before a room becomes active. New setup actions persist the prepared game state with the final setup event at one revision; readiness activation changes status without writing a second snapshot. A legacy waiting room is repaired in the activation transaction. A legacy active snapshot is repaired only when persisted events show no gameplay after the final setup event; ambiguous history blocks projections and actions to avoid overwriting a command. This recovery has contract-adapter coverage, with live PostgreSQL concurrency proof still open.

The expiry window is an operational policy, not a game rule: `ROOM_IDLE_TIMEOUT_MS` is 24 hours. The Memory store expires every noncompleted idle room when checked; Prisma exempts an `ACTIVE` room with at least one account-linked player. Meaningful room activity refreshes the deadline. Disconnect/reconnect does not bypass an expired room.

## Session and access policy

Guest access is bearer-token access: the room code identifies the room and the session token identifies the participant. Tokens are generated with 192 bits of random entropy and only their SHA-256 hashes are retained by the stores. WebSockets exchange this room token for a one-use ticket that expires after 30 seconds. A token never grants authority beyond its participant role, seat, current room status, and the authoritative revision/actor checks.

The current MVP policy is:

- A session is valid for 24 hours from creation or its most recent explicit rotation. Ticket consumption, socket activation, private socket projections, socket actions, and guarded HTTP mutations recheck the deadline at their persistence boundary. An already-open lease stops receiving private projections and cannot act after expiry. An HTTP read authorized while its session is live may finish after the deadline; HTTP reads do not promise an atomic response-time cutoff. There is no expiry timer that proactively closes an otherwise idle socket. A completed room remains readable only with a non-expired session at authorization time, while an expired room or expired session rejects ordinary reads, reconnects, and gameplay. Account-authenticated resume of a linked seat may replace an expired room token, provided the room itself has not expired.
- Disconnect has no short grace timer: the participant may reconnect during the room's 24-hour idle window. A room becomes abandoned only when every player is disconnected, and can recover when all ready players reconnect.
- There is no host privilege and no token transfer between participants. A creator's departure therefore follows ordinary disconnect rules. Verified accounts can link the current player seat; completed guest matches are not retroactively attached.
- Voluntary concession is the explicit inactive-player resolution; the client never converts a network failure into a concession.
- The API exposes `POST /rooms/:code/rotate-session`; both Memory and Prisma stores replace the stored hash, issue a replacement token, preserve the participant/role/seat, and reject the old token. Account holders can resume a linked match from another device, replacing the prior room session.
- Room privacy is bearer-token based: possession of a player token permits that player's projection, while a spectator token permits only the redacted spectator projection. Public usernames may appear in participant views, but account email and credential data remain private. Room codes and tokens are never sufficient to bypass role or revision checks.

The release checklist must revisit audit delivery, automatic rotation, and external identity integration before production deployment; the current endpoint is an explicit guest-session primitive, not an identity provider.
