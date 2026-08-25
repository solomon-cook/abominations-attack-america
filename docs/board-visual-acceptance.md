# Board visual acceptance record

This record compares the supplied browser reconstruction against the photographed board at the same landscape presentation. It is an evidence record, not visual acceptance or permission to promote the unresolved board.

## Comparison inputs

- Before/failure evidence: [full honeycomb evidence and forensic findings](full-honeycomb-board-evidence.md)
- Source comparison: [annotated 254-cell overlay](board-comparison-overlay.svg)
- Browser evidence: [first-playable browser evidence](first-playable-browser-evidence.md)
- Primary physical source: `../references/monsters-menace-america/components/board/full-game-setup.jpg`

## Acceptance matrix

| Check | Before reconstruction | Current candidate rendering | Acceptance status |
| --- | --- | --- | --- |
| Cell count | Dense shell was present but not independently measured | 254 candidate cells, in 13 rows of alternating 20/19 | Pass for candidate geometry |
| Tile orientation | Individual transforms and compressed rows made the lattice appear to overlap | One flat-top landscape orientation with row-level half-cell staggering | Pass for candidate geometry |
| Shared edges and gaps | Bounding-box overlap was visible in the comparison image | Polygon contract reports zero unintended candidate-cell intersections | Pass for candidate geometry |
| Vertical fit | Percentage row spacing was calculated in the wrong aspect-ratio space | Landscape canvas preserves the vertical pitch at short viewport heights | Pass for candidate geometry |
| Development overlays | Named nine-space locations were rendered as a second full-size hex lattice | Seven off-shell locations are compact fixture pins and are not presented as physical cells | Pass for development disclosure |
| Action controls | Lower-right controls obscured map cells | Action bar sits outside the map surface | Pass for interaction layout |
| Physical coastline and silhouette | Rectangular candidate extent did not match the board | Candidate remains a rectangular coordinate shell over a decorative backdrop | Failed; source-gated |
| Printed names, sites, bases, lairs, and benefits | Most cells showed `UNRESOLVED` and placeholder dots | Those values remain unresolved rather than being guessed | Failed; source-gated |
| Authored water classes and barriers | Not represented authoritatively | Candidate cells/edges remain unresolved and disabled for production | Failed; source-gated |
| Player-facing visual acceptance | No human sign-off | Geometry is machine-validated, but physical content and human review are outstanding | Not accepted |

## Current evidence

The candidate geometry is now validated by `npm run web-board-layout:verify`, and the responsive source contract guards the aspect-ratio canvas, action-bar placement, and fixture-pin treatment. The physical-board checks intentionally remain open: the source photograph shows enough to establish the filled honeycomb and irregular water boundary, but not enough to safely assign every printed rule datum and edge to a stable coordinate without aligned cell-level review.

Promotion requires the failed/source-gated rows above to be replaced with reviewed board data, followed by human sign-off and a regenerated immutable board content hash.
