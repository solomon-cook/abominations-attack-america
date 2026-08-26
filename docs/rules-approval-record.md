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

The approval authorizes the current best-guess playtest behavior to remain playable and visible as provisional. It does not convert guessed board data or source-gated rules into authoritative production data, and it does not replace the second-reviewer and release-sign-off requirements in [`docs/review-signoff.md`](review-signoff.md).

## Evidence

- `packages/game-engine/src/index.test.ts` and `packages/game-engine/src/effects.test.ts` cover the implemented engine boundaries.
- `docs/rules-traceability-matrix.md` maps the rules reference to implementation and tests.
- `docs/unresolved-rules-inventory.md` is the release-facing list of remaining source blockers.
- `npm run verify` is the consolidated local validation gate; its release-blocker report intentionally continues to report the unresolved production boundary.
