# Physical-board source review and promotion sign-off

Status: **pending human review** (physical-source capture and review required)

This record gates any claim that the digital board has been checked against the
user's physical edition or approved for source-faithful release. The current
local and room-game initializer pins the photo-transcribed candidate
`human-audited-north-america@1` (`AUDITED_BOARD`). `FULL_HONEYCOMB_BOARD` is a
separate structural shell, and `PROVISIONAL_AUTHORITATIVE_BOARD` is a separate
provisional definition. A validator pass or promotion of one does not promote
the others. See [board provenance reconciliation](board-source-status-reconciliation.md).

The candidate's board ID and content hash remain unchanged until source review
is complete. If the physical comparison requires data changes, publish a
separately recorded board version and retain a compatibility plan for matches
already pinned to the current candidate.

## Required source evidence and acceptance checks

- [ ] Record the exact user's physical edition/printing and the rulebook, board,
      records, and card captures used. Preserve source references, date, and
      reviewer; list any source pages or components that remain unavailable.
- [ ] Compare all 336 faces against the physical board: stable row/column and
      axial key, label or explicit blank/boundary, terrain class, all printed
      features, benefits, co-locations, overlays, and crop status.
- [ ] Resolve each lair identity from the physical board. For `10/2`, record
      whether the source reads Tomanagi, another name, or is unreadable; retain
      the existing “Toronagi or similar” transcription and runtime
      normalization as separate evidence until resolved.
- [ ] Check every printed adjacency, reciprocal edge, barrier, disabled edge,
      boundary, and exceptional connection against the physical board. Record
      the exact face pair and barrier class, including absent barriers.
- [ ] Independently verify candidate co-locations, including both bases at
      `6/21`, Infamy plus Navy base at `10/19`, Infamy/base pairs at `7/4`,
      `9/6`, and `10/11`, and Challenge site plus Navy base at `10/16`.
- [ ] Check the eight candidate inland Great Lakes faces (`2/15`, `3/16`,
      `3/17`, `3/18`, `3/19`, `4/17`, `4/18`, `4/19`) and each of the 22
      candidate lake-barrier edges against the printed boundary. Do not infer
      movement restrictions from shoreline artwork alone.
- [ ] Compare setup order and placement with the physical rulebook and branch
      records: first-player/monster choice order, reverse branch selection,
      starting lair, initial deployment versus Research draw, and placement of
      each unused non-National Guard branch when fewer than four players play.
      Verify the printed unit counts and every destination base.
- [ ] Compare the Navy Nuclear Submarine rules/card against the physical
      source. Record its choice points and full launch lifecycle: eligibility,
      timing, legal targets, attack/roll, Mutation draw (if any), unit
      disposition, and effects on the current phase or action. Do not infer
      these boundaries from code or the player-aid summary.
- [ ] Check source-region references and every non-obvious value against an
      independent reviewer or a second clear physical observation. Record
      ambiguity instead of selecting a convenient candidate.
- [ ] Run the structural board validator and require zero structural errors.
      This validates shape and internal consistency only; it cannot establish
      physical-source accuracy or approval.
- [ ] Run the relevant engine, API, browser, and persistence checks against the
      same board ID, version, and content hash. Confirm compatibility for
      existing matches before promoting a changed candidate.
- [ ] Complete the physical-board, independent-review, and rules/gameplay
      reviewer records below before a source-faithful release claim.

## Reviewer record

| Role | Name | Date | Physical evidence and checks reviewed | Approval |
| --- | --- | --- | --- | --- |
| Physical-board transcriber | pending | pending | pending | pending |
| Independent board reviewer | pending | pending | pending | pending |
| Rules/gameplay reviewer | pending | pending | pending | pending |

## Promotion decision

**Decision:** pending.

The 2026-08-26 playtest authorization is scoped to the labelled playtest and is
not a board-source sign-off. The previous transcription's 336 entries, its
source hash, a passing code validator, a public photograph, or a secondary
player aid cannot by themselves satisfy this record. Do not mark this decision
approved until the user's physical edition has been compared and the evidence
above is complete.
