# Human-audited board review and release sign-off

Status: **board-data and project-owner visual reviews approved; full release sign-off pending**

New MVP matches already use `AUDITED_BOARD` (`human-audited-north-america` v1),
compiled from [`authoritative-board-human-audit.md`](authoritative-board-human-audit.md).
This record separates the completed human review of board data and the
project-owner visual acceptance from the remaining independent, rules, and
release acceptance gates. The owner may reopen visual acceptance if an issue
is found later.

The project owner also confirmed the lair identity at audit cell `10/2`:
although the photographed lettering was initially transcribed as “Toronagi or
similar,” the physical symbol is Tomanagi. Its three reviewed row/column cells
are `10/2`, `11/15`, and `10/21`, mapping to axial keys `2,9`, `15,4`, and
`21,0` in `MONSTER_DEFINITIONS`. The cell and feature placement did not change.

## Required evidence

- [x] Every one of the 336 cells has a reviewed stable key and axial coordinate. (`AUDITED_BOARD`; `authoritative-board-human-audit.md`)
- [x] Every cell has a reviewed label or an explicit blank/sea/boundary result. (`authoritative-board-human-audit.md`)
- [x] Every cell has a reviewed land, lake-edge, sea, or seacoast class. (`authoritative-board-human-audit.md`)
- [x] Every printed city, base, Infamy site, Mutation site, Challenge site,
      lair, Los Angeles, and exceptional space is mapped to a cell; Hollywood is
      recorded as a non-visitable board overlay/area rather than a cell. (`authoritative-board-human-audit.md`)
- [x] Every reciprocal edge, water barrier, disabled edge, boundary, and
      exceptional connection has been checked against the physical board. (`AUDITED_BOARD` derives reciprocal edges from the reviewed cell observations.)
- [x] Every non-obvious datum has a source-region reference and an independent
      cross-check or an explicit physical-board observation. (`authoritative-board-human-audit.md` records the physical-board observations.)
- [x] All 32 physical branch bases map to the reviewed branch ownership across
      their 30 board cells, including both co-located spaces
      (`packages/game-engine/src/audited-board.test.ts`).
- [x] All 48 physical city benefits map from the signed-off audit into the
      authoritative board and resolve to the printed fixed Health or one-to-
      three-die benefit (`packages/game-engine/src/audited-board.test.ts`).
- [x] All 16 Infamy sites, four Mutation sites, four Challenge sites, 18 lairs,
      and the single Los Angeles return feature compile at exactly the reviewed
      physical cells, with no extra sites invented
      (`packages/game-engine/src/audited-board.test.ts`).
- [x] The generated review table and [`board-fit-comparison.svg`](board-fit-comparison.svg)
      were reviewed at the same orientation and scale as the source board.
      Project-owner visual review on 11 October 2026 found no issues; it may be
      reopened if an issue is found later. Independent review remains pending.
- [x] `validateBoardDefinition(AUDITED_BOARD, { production: true })` reports zero
      errors. (Covered by the audited-board engine test.)
- [x] Engine, API, and browser use the same audited board ID, version, and
      content hash for new MVP matches. (Engine/API room fixtures and the
      2026-10-07 local and three-session Chrome runs verify the shared pin.)
- [x] The online memory-backed MVP flow preserves the audited identity through
      browser reconnect and terminal reload. (`npm run browser:online:verify`,
      7 October 2026.)
- [ ] Durable database restart and production persistence recovery preserve the
      audited board identity. (No deployed database/persistence environment is configured.)

## Reviewer record

| Role | Name | Date | Evidence reviewed | Approval |
| --- | --- | --- | --- | --- |
| Physical-board data reviewer | Project owner | 8 October 2026 | 336-cell human audit and city, base, water, and barrier transcription, including spaces, features, edges, bases, and city benefits; user-authorized sign-off in Codex chat | Approved |
| Board visual reviewer | Project owner | 11 October 2026 | Same-scale `board-fit-comparison.svg` and generated review table | Approved; no issues found, may be reopened |
| Independent board reviewer | pending | pending | pending | pending |
| Rules/gameplay reviewer | pending | pending | pending | pending |

## Promotion decision

**Decision:** pending.

The board-data transcription and project-owner same-scale visual review are
approved. Keep overall release approval pending until independent review,
rules/gameplay review, and durable database persistence checks are complete.
