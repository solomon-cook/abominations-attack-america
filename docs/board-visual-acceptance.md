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
| Shared edges and gaps | Bounding-box overlap was visible in the comparison image | Polygon contract reports zero unintended candidate-cell intersections and a visible cream seam between every face | Pass for candidate geometry |
| Vertical fit | Percentage row spacing was calculated in the wrong aspect-ratio space | Landscape canvas preserves the vertical pitch at short viewport heights | Pass for candidate geometry |
| Development overlays | Named nine-space locations were rendered as a second full-size hex lattice | Nine canonical development locations overlay the 254-cell candidate shell; unresolved shell faces remain disabled and neutral | Pass for development disclosure |
| Reconstruction overlays | Decorative board title and Hollywood label crossed the tile lattice | Gameplay no longer renders those non-authoritative overlays; the home artwork and board source-status copy remain outside the tile surface | Pass for player-surface cleanup |
| Action controls | Lower-right controls obscured map cells | Action bar sits outside the map surface | Pass for interaction layout |
| Board identity | Browser rendered the unresolved full shell over a development match | Browser selects the board definition and content hash pinned by the active match | Pass for development boundary; MVP remains source-gated |
| Physical coastline and silhouette | Rectangular candidate extent did not match the board | Candidate remains a rectangular coordinate shell over a decorative backdrop | Failed; source-gated |
| Printed names, sites, bases, lairs, and benefits | Most cells showed `UNRESOLVED` and placeholder dots | Those values remain unresolved rather than being guessed | Failed; source-gated |
| Authored water classes and barriers | Not represented authoritatively | Candidate cells/edges remain unresolved and disabled for production | Failed; source-gated |
| Player-facing visual acceptance | No human sign-off | Geometry is machine-validated, but physical content and human review are outstanding | Not accepted |

## Current evidence

The candidate geometry is now validated by `npm run web-board-layout:verify`, and the responsive source contract guards the aspect-ratio canvas, action-bar placement, and fixture-pin treatment. The physical-board checks intentionally remain open: the source photograph shows enough to establish the filled honeycomb and irregular water boundary, but not enough to safely assign every printed rule datum and edge to a stable coordinate without aligned cell-level review.

The asset gate also checks every manifest-declared PNG/WebP pair and fails if the WebP derivative is missing or not smaller than its source. This protects the cream-face and board-art delivery path from silently regressing to oversized source assets; it does not establish final art licensing or physical-board fidelity.

The home screen exposes `Review full board shell`, and the development match now also renders the same 254 separated cream candidate faces as a disabled visual shell. Nine canonical development spaces are overlaid at their fixture positions and remain the only enabled gameplay destinations. The read-only review surface supports keyboard/click selection of an individual face and exposes its canonical key, coordinate, verification state, feature state, and source references. Neither surface promotes unresolved physical content to playable board data.

The read-only review surface also displays optimized copies of both the 2,840 × 1,752 setup photograph and the independent top-down photograph beneath the candidate lattice. These are comparison evidence only: they are labelled reference-only, are not used as board art or topology, and do not replace cell-level transcription or human sign-off.

On 2026-08-26, a live desktop review found that the gameplay map was still carrying a decorative board title and Hollywood region label across the candidate faces. Those overlays were removed from the player surface and the local Chrome smoke now asserts that `.map-copy` and `.region-label` are absent. This is a cleanup of reconstruction artefacts, not evidence that the physical coastline, printed labels, or feature coordinates have been transcribed.

On 2026-08-26, fresh Chrome sessions opened that control at 1280×720, 834×1112, and 390×844 and verified 254 rendered `.board-review-hex` faces, 13 rows, the cream-face treatment, cell containment, individual-cell inspection, no playable tiles, no unresolved labels, and no horizontal overflow. The screenshot and runtime results are evidence of candidate geometry only; they are not physical-board acceptance or MVP playability.

On 2026-08-26, a fresh 1280×720 capture was visually compared with the supplied setup photograph at the same landscape fit. It confirms the geometry fix: every visible face is the same flat-top orientation, each cream face is individually separated by a uniform seam, and no neighbour overlaps. It also confirms the remaining failure: the candidate is a regular rectangular shell of neutral faces, while the source board has an irregular land/coast/sea silhouette and authored printed features. The current capture therefore passes seam/orientation containment checks but fails the source-faithful board comparison and remains read-only.

Promotion requires the failed/source-gated rows above to be replaced with reviewed board data, followed by human sign-off and a regenerated immutable board content hash.

On 2026-08-26, the automated acceptance set was rerun together: `browser:keyboard:verify` completed the Tab/Space development victory route and accessibility-tree assertions; `browser:local:matrix` passed at 1280×720, 834×1112, and 390×844; `browser:visual:verify` matched the checked-in Chrome baselines; and `browser:board-review:verify` confirmed the 254-cell candidate, 13 rows, cream seams, containment, references, and 1–8 dense-stack fixture artwork. This strengthens the candidate-rendering evidence only; it does not close the human physical-board, screen-reader, touch, or source-faithfulness acceptance rows.
