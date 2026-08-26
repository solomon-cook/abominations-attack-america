# Full-board promotion sign-off

Status: **pending human review**

This is the explicit approval record required before `FULL_HONEYCOMB_BOARD` can
become the MVP playable board. It is intentionally incomplete: no reviewer,
date, source alignment, or board datum is inferred by the repository.

## Required evidence

- [ ] Every one of the 336 cells has a reviewed stable key and axial coordinate.
- [ ] Every cell has a reviewed label or an explicit blank/sea/boundary result.
- [ ] Every cell has a reviewed `land`, `lake`, `sea`, or `seacoast` class.
- [ ] Every printed city, base, Infamy site, Mutation site, Challenge site,
      lair, Los Angeles, and exceptional space is mapped to a cell; Hollywood is
      recorded as a non-visitable board overlay/area rather than a cell.
- [ ] Every reciprocal edge, water barrier, disabled edge, boundary, and
      exceptional connection has been checked against the physical board.
- [ ] Every non-obvious datum has a source-region reference and an independent
      cross-check or an explicit physical-board observation.
- [ ] The generated review table and comparison overlays were reviewed at the
      same orientation and scale as the source board.
- [ ] `validateBoardDefinition(board, { production: true })` reports zero
      errors for the promoted board.
- [ ] Engine, API, browser, and persistence fixtures all use the same promoted
      board ID, version, and content hash.

## Reviewer record

| Role | Name | Date | Evidence reviewed | Approval |
| --- | --- | --- | --- | --- |
| Physical-board transcriber | pending | pending | pending | pending |
| Independent board reviewer | pending | pending | pending | pending |
| Rules/gameplay reviewer | pending | pending | pending | pending |

## Promotion decision

**Decision:** pending.

Do not change this to approved merely because the coordinate shell, browser
geometry, or generated overlays pass validation. Those prove structural and
visual scaffolding only; they do not prove the printed physical-board data.
