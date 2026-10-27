# Setup model

`packages/game-engine/src/setup.ts` is the authoritative setup state machine. It deliberately accepts verified component and board definitions as inputs rather than embedding uncertain source facts.

The model currently enforces:

- ordered monster selection, with one unclaimed monster per seat;
- reverse-order selection of one eligible non-National-Guard branch;
- placement by the last monster picker of every unused branch unit on a distinct base belonging to that branch when fewer than four players participate;
- distinct monster, branch, and lair assignments;
- lair eligibility for the selected monster;
- one starting choice and readiness confirmation per player; and
- completion validation for two-, three-, and four-seat fixtures.

National Guard inventory/control rules, branch quantities, and legal starting deployment destinations remain explicit source-audit blockers. The audited setup definition now uses the reviewed lair catalogue and reviewed branch bases; the generic development fixture retains its own isolated monster and lair IDs.

The fewer-than-four-player placement rule is confirmed by the canonical rules transcription: the last player places each unused non-National Guard branch's units on that branch's board bases, one unit per base (`docs/monsters-menace-america-rules.md:96-97`). The audited setup definition now derives those base lists and the matching physical unit IDs from the human-reviewed board and source-counted inventory. Setup requires one-to-one unit/base assignments within each unused branch, and completion moves the units onto the selected audited hexes.

Coverage: `packages/game-engine/src/audited-board.test.ts` verifies two-player placements, the three-player last-picker and bot path, missing/duplicate/cross-branch rejection, shared printed base hexes, and four-player skip behavior. `apps/api/src/store.test.ts` verifies that only the last monster picker can submit the persisted placement through the online store path.

Starting Research choices resolve immediate card instructions as the card is
drawn: X-Fighters enter the owner's reserve, while Mecha-Monster and Captain
Colossal are placed on an owned branch base and discarded. The same resolver is
used when setup previews replay earlier seats' choices. A development board
without a branch base keeps the giant card in hand and records why placement
could not be completed; audited-board fixtures verify the resolved outcomes.

## Development browser flow

The web client now exercises this state machine locally with an explicitly labelled development fixture in `apps/web/src/development-setup.ts`. Completing that flow calls `createGameFromSetup`, preserves the selected assignments in `GameState.setupAssignments`, and then enters the existing simplified turn loop. The fixture is deliberately not a production fallback: its IDs and lairs are development values, and the UI names the source-gated status so it cannot be mistaken for verified setup data.

Online development rooms persist the same `SetupState` inside the room snapshot. Authenticated `POST /rooms/:code/setup` actions are applied through the shared state machine, recorded as room events, and must reach `complete` before readiness can activate gameplay. A production room must replace the development definition with verified component and board data before release.
