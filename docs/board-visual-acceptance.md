# Board visual acceptance record

This record preserves the 2026-08-26 comparison of the then-current browser reconstruction against the photographed board. Its historical failure rows describe that candidate and are superseded by the current status below.

## Current status — 2026-10-11

- The 336-cell physical-board transcription, including features, labels, city benefits, bases, lairs, water classes, barriers, and edges, is implemented as `AUDITED_BOARD` and approved by the user. See [`board-promotion-signoff.md`](board-promotion-signoff.md) and [`authoritative-board-human-audit.md`](authoritative-board-human-audit.md).
- On 2026-10-08, the board guides, compiled observations, runtime art map, and delivered-art manifest were regenerated from the signed-off audit. `npm run board-art:build` and `npm run board-audited-assets:verify` passed for all 336 cell mappings, 75 unique geography cells, 81 source masters, and 1,008 WebP derivatives; the audit hash and each cell's source-line reference now stay synchronized. The reviewed image assembly was reused without changing board data or artwork. This verifies provenance and delivery consistency; independent review and full release sign-off remain open.
- New MVP matches use this audited board. Strict board validation, seven-size local browser checks, and online shared-board identity/reconnect checks have passed; see [`first-playable-browser-evidence.md`](first-playable-browser-evidence.md).
- Reset now uses contain framing instead of cropping to cover: 2026-10-07 Chrome runs verified all 336 cell faces inside the board viewport at 1440×900 and 390×844. [`board-fit-1440x900.png`](../output/board-art/board-fit-1440x900.png) is a HUD-free fit capture. [`board-fit-comparison.svg`](board-fit-comparison.svg) compares it with a board-area crop from the physical photo in equal 640×400 frames; the photo is uniformly scaled and retains its perspective. The project owner accepted the same-scale visual review on 2026-10-11 with no issues noted; this result can be reopened if issues are found later.
- The focused-label pass enlarged the vector city/site/lair/challenge text and raised audited city names to responsive fit-zoom sizing. Full-board inspection verified every visible name stays inside its hex, all 336 controls expose row/column plus canonical feature detail, and a focus-triggered board-adjacent detail tray works outside the collapsed controls panel. Board-fit captures are available at [`1440×900`](../output/board-art/board-fit-1440x900.png) and [`390×844`](../output/board-art/board-fit-390x844.png); focused San Francisco city-detail captures are [`desktop`](../output/board-art/board-inspection-1440x900.png) and [`phone`](../output/board-art/board-inspection-390x844.png). Browser checks confirm the focused tray stays within both viewports without clipping. Full-fit phone labels remain tiny at this scale. The owner found no visual issue in the same-scale review; independent review remains open.
- The 2026-10-07 phone-marker refinement widened the feature-symbol lanes and strengthened contrast around city/site benefits and branch-base marks at widths up to 600px. That run passed at 390×844 and 1440×900, but the phone fit capture still showed overview labels too small for acceptance. The follow-up below removed the microtext and supplied readable focused detail.
- Follow-up at 390×844 removes the unreadable 3–5px city-name microtext from the full-board overview while retaining the larger vector benefit/site marks; tapping or focusing a city exposes its full name and exact benefit in the board-adjacent tray. The refreshed `browser:audited:verify -- --inspection-only` run passed at 390×844 and 1440×900, with all 336 faces in frame, phone feature symbols present, full accessible cell descriptions, readable tray text, and no clipping. The owner visual review is accepted; manual assistive-technology acceptance remains open.
- The 2026-10-07 `npm run browser:ci:verify` run also checked the read-only audited-board review at 1280×720, 834×1112, and 390×844: all 336 terrain-art assignments match their audited coordinates, visible art and both reference photographs load, every face stays inside the frame, and the selectable inspector and 1–8 dense-stack fixtures remain available. This automated result does not replace independent review; project-owner same-scale acceptance was recorded on 11 October below.
- Project-owner same-scale visual acceptance was recorded on 2026-10-11 with no issues found; it may be reopened if a problem is found later. Independent reviewer sign-off, manual assistive-technology acceptance, and durable database restart/persistence acceptance remain open.

## Visual review checklist and owner result — 2026-10-11

Compare [`board-fit-comparison.svg`](board-fit-comparison.svg) with the reset-fit
captures at [`1440×900`](../output/board-art/board-fit-1440x900.png) and
[`390×844`](../output/board-art/board-fit-390x844.png). Both comparison panels
use the same 640×400 frame; the source-photo crop is uniformly scaled to retain
its aspect ratio rather than stretched. Photo perspective remains, so use the
cell audit and browser review surface when a boundary is ambiguous. The
project's 336-cell data approval is recorded separately.

For an additional silhouette and coastline view, reviewers can also consult
[`board-fit-comparison-perspective-approximate.svg`](board-fit-comparison-perspective-approximate.svg),
which uses the top-down board photograph. Its photo crop and perspective match
are explicitly approximate; use it as a secondary reference, not as the
same-scale comparison or as acceptance evidence.

Both comparison SVGs embed their photo and current audited-fit capture, so they
render as standalone files without resolving repository-relative image paths.
`npm run board-fit-comparison:verify` checks that the embedded images match the
current source files; use `npm run board-fit-comparison:refresh` after either
image changes. The project owner reviewed the same-scale comparison on
2026-10-11 and reported no issues. This closes the owner-review column below;
the independent-review column remains pending. Reopen the owner result if an
issue is identified later.

| Reviewer check | Current evidence | Project owner | Independent reviewer | Notes/corrections |
| --- | --- | --- | --- | --- |
| Cell count, 14-row pattern, and alternating row offsets | Matched-fit comparison; [read-only full-board review](first-playable-browser-evidence.md) | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| Outer silhouette, coast/sea cut-outs, and off-board boundary | Matched-fit comparison; [human audit](authoritative-board-human-audit.md) | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| Printed features, cities and benefits, lairs, and branch bases belong to the correct cells | [336-cell audit](authoritative-board-human-audit.md); cell inspector in read-only review | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| City and feature labels remain readable at desktop and phone fit; detail is available for suppressed microtext | Desktop and phone fit captures; focused-cell inspection captures linked above | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| Piece groups remain inside their owning faces and do not overlap as stacks grow | [Browser verification result](../output/board-art/browser-online-verification.json); read-only review fixtures cover 1–8 pieces | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| Rule-bearing cells and interaction targets stay visible and unobscured by controls | [Browser evidence and viewport matrix](first-playable-browser-evidence.md) | Pass (2026-10-11) | Pending | No issues reported; reopen if needed. |
| Overall visual acceptance | All checks above plus the supplied physical-board reference | Pass (2026-10-11) | Pending | Project owner found no issues; reopen if needed. |

Record any correction by coordinate and classify it as geometry, source data,
artwork ownership, label/readability, piece layout, or responsive interaction.
The owner's visual review is accepted. Retain the board-promotion gate until
independent review and remaining release acceptance are complete; record and
resolve any issues if this owner result is reopened.

## Comparison inputs

- Before/failure evidence: [full honeycomb evidence and forensic findings](full-honeycomb-board-evidence.md)
- Source comparison: [annotated 336-cell overlay](board-comparison-overlay.svg); current candidate content is in the [feature/water/barrier audit](board-feature-audit-overlay.svg)
- Browser evidence: [first-playable browser evidence](first-playable-browser-evidence.md)
- Primary physical source: `../references/monsters-menace-america/components/board/full-game-setup.jpg`

## Historical acceptance matrix — 2026-08-26 candidate

| Check | Before reconstruction | Current candidate rendering | Acceptance status |
| --- | --- | --- | --- |
| Cell count | Dense shell was present but not independently measured | 336 candidate cells, in 14 rows of 24 | Pass for candidate geometry |
| Tile orientation | Individual transforms and compressed rows made the lattice appear to overlap | One flat-top orientation with column-level half-height staggering and shared edges | Pass for candidate geometry |
| Shared edges and gaps | Bounding-box overlap was visible in the comparison image | Polygon contract reports zero unintended candidate-cell intersections and a visible cream seam between every face | Pass for candidate geometry |
| Vertical fit | Percentage row spacing was calculated in the wrong aspect-ratio space | Landscape canvas preserves the vertical pitch at short viewport heights | Pass for candidate geometry |
| Development overlays | Named nine-space locations were rendered as a second full-size hex lattice | Nine canonical development locations overlay the 336-cell candidate shell; unresolved shell faces remain disabled and neutral | Pass for development disclosure |
| Reconstruction overlays | Decorative board title and Hollywood label crossed the tile lattice | Gameplay no longer renders those non-authoritative overlays; the home artwork and board source-status copy remain outside the tile surface | Pass for player-surface cleanup |
| Action controls | Lower-right controls obscured map cells | Action bar sits outside the map surface | Pass for interaction layout |
| Board identity | Browser rendered the unresolved full shell over a development match | New MVP rooms pin and render `AUDITED_BOARD`; the provisional shell remains isolated | Pass for audited MVP identity |
| Physical coastline and silhouette | Rectangular candidate extent did not match the board | Physical cells, coastline, and boundary are transcribed in `AUDITED_BOARD` | Owner data sign-off and same-scale visual review passed; independent review pending |
| Printed names, sites, bases, lairs, and benefits | Most cells showed `UNRESOLVED` and placeholder dots | Reviewed physical labels, sites, bases, lairs, and benefits are keyed in `AUDITED_BOARD` | Owner data sign-off and same-scale visual review passed; independent review pending |
| Authored water classes and barriers | Not represented authoritatively | Reviewed water classes, reciprocal edges, and barriers are keyed in `AUDITED_BOARD` | Owner data sign-off and same-scale visual review passed; independent review pending |
| Player-facing visual acceptance | No human sign-off | Project owner accepted the same-scale comparison on 11 October 2026 with no issues found | Accepted by project owner; independent review pending |

## Historical candidate evidence — 2026-08-26

The candidate geometry is now validated by `npm run web-board-layout:verify`, and the responsive source contract guards the aspect-ratio canvas, action-bar placement, and fixture-pin treatment. The physical-board checks intentionally remain open: the source photograph shows enough to establish the filled honeycomb and irregular water boundary, but not enough to safely assign every printed rule datum and edge to a stable coordinate without aligned cell-level review.

The asset gate also checks every manifest-declared PNG/WebP pair and fails if the WebP derivative is missing or not smaller than its source. This protects the cream-face and board-art delivery path from silently regressing to oversized source assets; it does not establish final art licensing or physical-board fidelity.

The home screen exposes `Review full board shell`, and the development match now also renders the same 336 separated cream candidate faces as a disabled visual shell. Nine canonical development spaces are overlaid at their fixture positions and remain the only enabled gameplay destinations. The read-only review surface supports keyboard/click selection of an individual face and exposes its canonical key, coordinate, verification state, feature state, and source references. Neither surface promotes unresolved physical content to playable board data.

The read-only review surface also displays optimized copies of both the 2,840 × 1,752 setup photograph and the independent top-down photograph beneath the candidate lattice. These are comparison evidence only: they are labelled reference-only, are not used as board art or topology, and do not replace cell-level transcription or human sign-off.

On 2026-08-26, a live desktop review found that the gameplay map was still carrying a decorative board title and Hollywood region label across the candidate faces. Those overlays were removed from the player surface and the local Chrome smoke now asserts that `.map-copy` and `.region-label` are absent. This is a cleanup of reconstruction artefacts, not evidence that the physical coastline, printed labels, or feature coordinates have been transcribed.

On 2026-08-26, fresh Chrome sessions opened that control at 1280×720, 834×1112, and 390×844 and verified 336 rendered `.board-review-hex` faces, 14 rows, the cream-face treatment, cell containment, individual-cell inspection, no playable tiles, no unresolved labels, and no horizontal overflow. The screenshot and runtime results are evidence of candidate geometry only; they are not physical-board acceptance or MVP playability.

On 2026-08-26, the generated comparison overlay was rendered over the supplied setup photograph. It confirms the diagnostic geometry is a connected flat-top honeycomb with face-centred labels and clipped edge rows. It also confirms the remaining failure: the candidate is still a regular shell of neutral faces, while the source board has an irregular land/coast/sea silhouette and authored printed features. The current artifact therefore passes geometric interlock checks but fails the source-faithful board comparison and remains read-only.

At that review date, promotion required the failed/source-gated rows to be replaced with reviewed board data, followed by human sign-off and a regenerated immutable board content hash. Those data steps were completed on 2026-10-07 and signed off on 2026-10-08; same-scale visual acceptance and independent review remain open as recorded above.

On 2026-08-26, the automated acceptance set was rerun together: `browser:keyboard:verify` completed the Tab/Space development victory route and accessibility-tree assertions; `browser:local:matrix` passed at 1280×720, 834×1112, and 390×844; `browser:visual:verify` matched the checked-in Chrome baselines; and `browser:board-review:verify` confirmed the 336-cell candidate, 14 rows, cream seams, containment, references, and 1–8 dense-stack fixture artwork. This strengthens the candidate-rendering evidence only; it does not close the human physical-board, screen-reader, touch, or source-faithfulness acceptance rows.

The same responsive matrix was rerun after the status-strip review. The persistent `monster-movement` pending-decision label is now fully visible at desktop, tablet, and mobile widths instead of being clipped by a fixed status height. This is a HUD readability fix and does not change board topology or the physical-board acceptance boundary.
