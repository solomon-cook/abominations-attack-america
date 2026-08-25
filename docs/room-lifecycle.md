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

Not yet defined: disconnect grace periods and token expiry/rotation. These remain operational decisions rather than invented game rules.
