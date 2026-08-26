# Setup model

`packages/game-engine/src/setup.ts` is the authoritative setup state machine. It deliberately accepts verified component and board definitions as inputs rather than embedding uncertain source facts.

The model currently enforces:

- ordered monster selection, with one unclaimed monster per seat;
- reverse-order selection of one eligible non-National-Guard branch;
- distinct monster, branch, and lair assignments;
- lair eligibility for the selected monster;
- one starting choice and readiness confirmation per player; and
- completion validation for two-, three-, and four-seat fixtures.

The production board's complete lair catalogue, National Guard inventory/control rules, branch quantities, and legal starting deployment destinations remain explicit source-audit blockers. They must be supplied through verified definitions before the setup state can be promoted from a validated generic model to the production match initializer.

The fewer-than-four-player starting placement rule is also source-gated. The current component records establish each branch's unit inventory and normal deployment allowance, but the available evidence does not establish whether unselected branches place units on their bases, remain on their record tiles, or follow another setup instruction. The engine therefore does not invent a placement and keeps those units on the record tile until a source-backed rule is available.

## Development browser flow

The web client now exercises this state machine locally with an explicitly labelled development fixture in `apps/web/src/development-setup.ts`. Completing that flow calls `createGameFromSetup`, preserves the selected assignments in `GameState.setupAssignments`, and then enters the existing simplified turn loop. The fixture is deliberately not a production fallback: its IDs and lairs are development values, and the UI names the source-gated status so it cannot be mistaken for verified setup data.

Online development rooms persist the same `SetupState` inside the room snapshot. Authenticated `POST /rooms/:code/setup` actions are applied through the shared state machine, recorded as room events, and must reach `complete` before readiness can activate gameplay. A production room must replace the development definition with verified component and board data before release.
