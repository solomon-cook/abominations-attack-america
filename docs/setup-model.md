# Setup model

`packages/game-engine/src/setup.ts` is the authoritative setup state machine. It deliberately accepts verified component and board definitions as inputs rather than embedding uncertain source facts.

The model currently enforces:

- ordered monster selection, with one unclaimed monster per seat;
- reverse-order selection of one eligible non-National-Guard branch;
- distinct monster, branch, and lair assignments;
- lair eligibility for the selected monster;
- one starting choice and readiness confirmation per player; and
- completion validation for two-, three-, and four-seat fixtures.

The regular local/room initializer currently uses the 336-cell `AUDITED_BOARD` photo-transcribed candidate for labelled playtesting. The candidate's full lair catalogue, National Guard inventory/control rules, branch quantities, and legal starting deployment destinations remain explicit physical-source blockers. Verified definitions are required before this playtest initializer can be described as source-faithful or approved for production release; the state machine itself is already used by the current match initializer.

The checked-in rulebook image on page 5 and the secondary player-aid summary describe the fewer-than-four-player starting placement rule as the last player placing each unused non-National Guard branch's units on that branch's bases, one per base (`docs/rulebook-page-alignment-audit.md`, `docs/player-aid-source-audit-2026-08-26.md`). The image's match to the user's printing and the unit counts/physical base destinations still need confirmation from the user's rulebook and branch records. Exact base coordinates remain source-gated with the physical board; the engine must not treat this image comparison or candidate coordinates as physical-source approval. Physical acceptance checks are listed in `docs/board-promotion-signoff.md`.

## Development browser flow

The web client now exercises this state machine locally with an explicitly labelled development fixture in `apps/web/src/development-setup.ts`. Completing that flow calls `createGameFromSetup`, preserves the selected assignments in `GameState.setupAssignments`, and then enters the existing simplified turn loop. The fixture is deliberately not a production fallback: its IDs and lairs are development values, and the UI names the source-gated status so it cannot be mistaken for verified setup data.

Online development rooms persist the same `SetupState` inside the room snapshot. Authenticated `POST /rooms/:code/setup` actions are applied through the shared state machine, recorded as room events, and must reach `complete` before readiness can activate gameplay. A production room must replace the development definition with verified component and board data before release.
