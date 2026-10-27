# Playtest rules approval record

## Approval

On 2026-08-26, Solomon approved the current implemented and tested rules behavior for the promoted `playtest-0.2-promoted-guess` ruleset as suitable for the labelled MVP playtest.

This approval covers the behavior that is present in the engine and its projections/tests, including setup, movement, combat sequencing, encounters, deployment, Challenge flow, implemented Mutation/Research effects, hidden-information boundaries, reconnect handling, and the temporary playtest victory condition.

## Explicit boundary

This is not production source sign-off. The following remain fail-closed and are not claimed as approved production rules:

- physical board geometry, printed features, water classes, barriers, bases, lairs, and off-board edges;
- monster lair assignments and any unresolved monster special-effect boundaries;
- physical giant/base placement;
- the source-gated Cutbacks, Molecular Cannon, and Chopper Lift effects;
- unresolved stacking/conflict or component-dependent exceptions;
- managed persistence, deployment, security, accessibility, and release acceptance.

This 2026-08-26 approval records the then-current labelled playtest rules behavior. Board data status has since changed: new MVP matches use `AUDITED_BOARD`, whose 336-cell data received user-authorized sign-off on 2026-10-08 (`docs/board-promotion-signoff.md`). That data approval does not close the independent review, same-scale visual, source-gated rules, or overall release-sign-off requirements in [`docs/review-signoff.md`](review-signoff.md). Existing match identities remain pinned to their original board version.

## Evidence

- `packages/game-engine/src/index.test.ts` and `packages/game-engine/src/effects.test.ts` cover the implemented engine boundaries.
- `docs/rules-traceability-matrix.md` maps the rules reference to implementation and tests.
- `docs/unresolved-rules-inventory.md` is the release-facing list of remaining source blockers.
- `npm run verify` is the consolidated local validation gate; its release-blocker report intentionally continues to report the unresolved production boundary.
