# Player rules — development playtest

This is a short guide to the current development playtest. It describes the prototype controls and behavior, not a complete transcription of the tabletop rules or a release-approved ruleset. The user's physical edition remains authoritative; board labels, coordinates, terrain, card boundaries, and other source disputes are not settled by this guide.

## Start a match

1. Choose a monster in seat order.
2. Choose a military branch in reverse seat order.
3. Choose one of the lairs offered for that monster on the current board candidate.
4. Choose a starting Research draw or an available development deployment option.
5. In an online room, each seated player confirms readiness after setup.

The setup flow supports two, three, or four seats. Its current monster/lair data and starting-placement choices are development inputs and still require physical-edition review.

## Take a turn

The active player follows the four-step prompt. The implementation for each step remains part of the development ruleset:

- **Move:** choose an engine-listed legal monster path, or keep the monster in place. Military units can also be selected when a legal unit path is available.
- **Fight:** resolve queued battles and the decisions currently exposed by the prototype, including applicable target, retreat, and multi-attack choices.
- **Encounter:** resolve the current board candidate's site reward or displayed choice.
- **Deploy:** deploy or redeploy an available development unit, draw Research where allowed, use an available Research action, or pass deployment.

## Board and rules status

Normal local and room games currently use a 336-cell board candidate. The code calls it `AUDITED_BOARD`, but that name is not physical-edition sign-off: the cell labels, coordinates, terrain, features, edges, and rule effects remain subject to review against the user's copy. Do not treat the board as a faithful reproduction of the physical game.

The nine-location graph is still present as a separate engine development fixture and appears in focused or temporary development scenarios; it is not the normal local/room play board. Board promotion and production rules approval remain pending.

## End a match

The prototype has development outcomes for the Monster Challenge, temporary Stomp or board-exhaustion scenarios, and concession. These outcomes have not all been approved against the user's physical rules. A player may confirm **Concede match**; the prototype records the next seat as winner. Completed local matches can start another playtest, and online participants can return to the lobby.

## Information and connection

The server is authoritative for commands, revisions, dice outcomes, and player/spectator projections. Opponent hands and deck order are not shown. After a connection drops, the client retries through WebSocket or polling and refreshes the authoritative snapshot before another action.
