# Player rules — development playtest

This is a concise guide to the current local development playtest. It is not the complete tabletop rules and is not a release sign-off.

## Start a match

1. Choose a monster in order.
2. Choose branches in reverse player order.
3. Choose a recorded lair.
4. Choose a starting Research draw or the development deployment option.
5. In an online room, every seated player presses Ready.

## Take a turn

The active player follows the visible four-step prompt:

- **Move:** move the monster along an engine-provided legal path, or leave it in place. Military units can be selected when a legal unit path exists.
- **Fight:** resolve every compulsory battle. The prompt exposes required target, retreat, and multi-attack decisions.
- **Encounter:** resolve the current development site reward or displayed choice.
- **Deploy:** place an available development unit, draw Research where allowed, or pass deployment.

The board photograph and 336-cell overlay are review references only. The development playtest renders and uses the explicitly labelled nine-space fixture; the unresolved physical board is not rendered as playable topology until it is fully transcribed and signed off.

## End a match

The current development playtest can end when its temporary Stomp or board-exhaustion condition is reached. A player may confirm **Concede match**; the next seat is recorded as winner. Completed local matches can start another local playtest, and online participants can return to the lobby.

## Information and connection

The server is authoritative for commands, revisions, dice outcomes, and projections. Opponent hands and deck order are not shown. If a connection drops, the client retries through WebSocket or polling and refreshes the authoritative snapshot before another action.
