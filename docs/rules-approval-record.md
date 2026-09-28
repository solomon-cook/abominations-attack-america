# Playtest rules approval record

## Approval

On 2026-08-26, Solomon approved the then-current implemented and tested behavior for the `playtest-0.2-promoted-guess` ruleset as suitable for a clearly labelled MVP playtest. This is a historical playtest authorization only. It is not evidence that the behavior was checked against the user's physical edition.

This approval covers the behavior that is present in the engine and its projections/tests, including setup, movement, combat sequencing, encounters, deployment, Challenge flow, implemented Mutation/Research effects, hidden-information boundaries, reconnect handling, and the temporary playtest victory condition.

## Explicit boundary

This record is not source verification, board promotion, or production release approval. The following remain open and are not claimed to match the user's physical edition:

- physical board geometry, printed features, water classes, barriers, bases, lairs, and off-board edges;
- monster lair assignments and any unresolved monster special-effect boundaries;
- physical giant/base placement;
- the source-gated Cutbacks, Molecular Cannon, and Chopper Lift effects;
- unresolved stacking/conflict or component-dependent exceptions;
- managed persistence, deployment, security, accessibility, and release acceptance.

The approval authorizes only the playtest scope stated above. It does not authorize a production release, convert candidate board or component data into source-verified facts, or replace the reviewer and release-sign-off requirements in [`docs/review-signoff.md`](review-signoff.md). Any source-verified replacement board must have a recorded version and content hash; the candidate currently used by runtime matches remains identified by its existing board ID and hash for compatibility.

## Evidence

- `packages/game-engine/src/index.test.ts` and `packages/game-engine/src/effects.test.ts` cover the implemented engine boundaries.
- `docs/rules-traceability-matrix.md` maps the rules reference to implementation and tests.
- `docs/unresolved-rules-inventory.md` is the release-facing list of remaining source blockers.
- `npm run verify` is the consolidated local validation gate; its release-blocker report intentionally continues to report the unresolved production boundary.
