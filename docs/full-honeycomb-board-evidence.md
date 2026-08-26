# Full honeycomb board evidence pack

This pack is the review boundary for promoting the photographed board into the MVP ruleset. It separates the visible board extent and coordinate shell from printed rule data that has not yet been independently transcribed.

## Source photographs

- [Full board top-down reference](../references/monsters-menace-america/components/board/full-board-top-down.jpg)
- [Full game setup reference](../references/monsters-menace-america/components/board/full-game-setup.jpg)
- Optimized JPEG copies are shipped only for the read-only review screen; the source JPGs above remain internal evidence and are never used as gameplay art or topology.
- [Generated 254-hex review table](board-review-table.md)
- [Generated coordinate/photo comparison overlay](board-comparison-overlay.svg)
- [Generated independent top-down cross-check overlay](board-top-down-overlay.svg)
- [Full-board promotion sign-off template](board-promotion-signoff.md)

## Supplementary public-source reconnaissance

On 2026-08-26, additional publicly accessible setup photographs were reviewed as
cross-checks, not as replacement rule authority:

- [BoardGameGeek board close-up](https://boardgamegeek.com/image/201674/monsters-menace-america)
- [BoardGameGeek full-board setup photograph, image 5699472](https://boardgamegeek.com/image/5699472/monsters-menace-america)
- [Blugee setup photograph](https://blugee.com/cdn/shop/files/Monsters-Menace-America-Board-Game-2_898x600.jpg?v=1711114433)
- [Independent setup photograph](https://i.ebayimg.com/00/s/MTYwMFgxNjAw/z/rtYAAOSw9fVmDcjE/%24_3.JPG)
- [Independent setup photograph, 1600px delivery](https://i.ebayimg.com/images/g/rtYAAOSw9fVmDcjE/s-l1600.jpg)
- [Scanned Italian rulebook, board photograph on PDF page 3](https://www.goblins.net/files/downloads/MonsterMenaceAmerica_Regolamento.pdf)

These references independently support the broad filled-board silhouette, blue
sea/coast boundary, green land field, and presence of printed city/site/base
families. The 1600px delivery makes some printed labels and the coast/land hex
treatment easier to inspect, but it remains oblique, cropped, and component-obscured;
it is not sufficiently aligned or complete to assign exact shell coordinates, water
classes, barriers, or benefits.
No rule-bearing datum is promoted from these images; they only increase confidence
in the broad visual classification and identify the need for an unobscured,
high-resolution top-down source or human physical-board review.

The optimized JPEG files are delivery copies for the read-only browser review. The original JPGs remain the source evidence and are not overwritten; optimization improves loading only and does not strengthen the transcription evidence.

## Additional source search

On 2026-08-26, a further public-source search checked the BoardGameGeek image
listing and an independent board-game setup photograph. The BoardGameGeek image
API identifies image 201674 as a 2048 × 1536 close-up and image 5699472 as a
2840 × 1752 full-board setup photograph. The latter is the strongest public
cross-check found: it exposes the broad board, cream seams, coast cut-outs, and
most printed feature families. It still has perspective and pieces/stomp markers
over central and western cells, so neither reference is suitable for assigning
exact shell coordinates, printed benefits, water classes, or barriers; they
remain reconnaissance references only, and no new rule-bearing data is
promoted from them.

- [BoardGameGeek board photograph](https://boardgamegeek.com/image/201674/monsters-menace-america)
- [Independent setup photograph](https://boardgameguys.com/monsters-menace-america/)

On 2026-08-26, a targeted search for a high-resolution scan, board PDF, or aligned
cell-readable map found additional setup photography and review pages, but no
new source that meets the promotion standard. The [Board Game Guys setup
page](https://boardgameguys.com/monsters-menace-america/) and the [Blugee board
listing](https://blugee.com/products/monsters-menace-america-board-game) provide
useful broad-board imagery; the [Knights of the Cardboard Castle photograph](https://knights.calltoreason.org/?p=4935)
also shows the game-board family. They are perspective photographs with
component occlusion or insufficient text resolution, not aligned top-down
transcriptions. No labels, features, water classes, barriers, or coordinate
edges were promoted from this search.

The [Italian rulebook scan](https://www.goblins.net/files/downloads/MonsterMenaceAmerica_Regolamento.pdf)
adds a partial board photograph on PDF page 3. It independently shows the
continuous flat-top honeycomb, cream face seams, blue water/coast field, and
printed feature families, but the board is cropped and viewed obliquely with
pieces and cards covering cells. It is therefore corroborating visual
reconnaissance only; no cell label, feature, water class, barrier, or edge was
promoted from it.

The same rulebook is useful for vocabulary, not geometry promotion: it describes
hexagonal board spaces, blue land/water spaces, water barriers, and the lake,
sea, sea-coast, and flight movement classes. Its rendered pages do not provide
an unobscured, aligned cell map, so those rules terms cannot be assigned to the
254 candidate coordinates without a reviewed transcription against the physical
board.

A further focused search on 2026-08-26 found no qualifying aligned scan or
printable board map. The [BoardGameGeek game overview](https://boardgamegeek.com/boardgame/17835/monsters-menace-america)
also describes the 2005 edition as removing terrain effects, while the scanned
[Italian rulebook](https://www.goblins.net/files/downloads/MonsterMenaceAmerica_Regolamento.pdf)
uses lake, sea, sea-coast, flight, and water-barrier movement vocabulary. This
may describe a distinction between terrain effects and movement restrictions,
but the sources are not sufficient to resolve that distinction for the digital
board. The implementation therefore keeps water classes and barriers
source-gated rather than selecting an interpretation.

## Current evidence

| Question | Current evidence | Status |
| --- | --- | --- |
| Is the board a filled honeycomb field? | Both photographs visibly show a dense, continuous honeycomb lattice across the board interior and water boundary. | Confirmed visually |
| How many coordinate cells are in the candidate shell? | `FULL_HONEYCOMB_BOARD` contains 13 staggered rows: seven rows of 20 cells and six rows of 19 cells, for 254 cells. | Structural candidate validated |
| Are coordinate keys and adjacency explicit? | The shell uses axial keys and reciprocal candidate adjacency; the generated review table lists every cell and edge. | Structural candidate validated |
| Are all printed labels and icons transcribed? | No. The photographs show cities, bases, sites, lairs, water, markers, and legend content, but no independent cell-by-cell transcription has been approved. | Unresolved |
| Are water classes and barriers authoritative? | The physical-board reference confirms that the thick blue line is the water barrier that blocks monsters without the appropriate ability. The exact cell-by-cell barrier edges and sea/lake classifications remain unresolved in the digital transcription. | Partially confirmed; mapping unresolved |
| Can this board be used for MVP play? | No. The nine-space development graph remains the only playable fixture until the rule-bearing fields are reviewed and promoted. | Release blocker |

The current production validator reports 1,902 errors for the candidate shell: 254 unresolved hex verification states, 254 unresolved water classes, and 1,394 unresolved edge barriers. These counts are intentionally redundant safeguards: promotion must not be possible by changing only a cell's verification flag while leaving terrain or movement data unresolved.

The overlay is deliberately a review aid: it places all 254 candidate coordinate keys over the source photograph, but it does not claim that any printed label, icon, water class, barrier, or edge has been transcribed.

## Evidence-quality assessment

The currently checked-in source photographs are useful for confirming the overall filled-board silhouette, but they are not sufficient by themselves for safe cell-level authoring:

| Asset | Dimensions | Reliable use | Not reliable for |
| --- | ---: | --- | --- |
| `full-board-top-down.jpg` | 753 × 623 | Overall lattice, outer water boundary, broad feature placement | Reading every printed label/icon, classifying every edge, or assigning a rule datum to a coordinate |
| `full-game-setup.jpg` | 2840 × 1752 | Cross-checking the board in a setup context and identifying broad component regions | Cell-by-cell transcription where pieces, cards, glare, or perspective obscure the printed board |
| BoardGameGeek image 5699472 (`MMA _Board`) | 2840 × 1752 original | Highest-resolution public cross-check found: full board, cream hex seams, water cut-outs, printed feature families, and broad cell lattice | Several central/western cells are covered by pieces or stomp markers; perspective and image resolution still require human cell-by-cell review |
| Independent setup photograph, 1600px delivery | 1600 × 1600 | Inspecting some printed labels and the coast/land hex treatment | Complete cell-by-cell transcription; large areas remain covered by components and the board is cropped/perspective-distorted |
| User-supplied comparison screenshot | 1280 × 706 | Demonstrating the current candidate-shell rendering failure: unresolved labels, placeholder dots, and rectangular extent | Authoritative physical-board topology; it is a browser reconstruction, not a source photograph |

The checked-in `board-top-down-overlay.svg` is an approximate alignment aid over the independent top-down photograph. Its corners are deliberately documented as approximate because the source is low-resolution and slightly skewed; it is useful for comparing the broad shell silhouette and row staggering, not for assigning a rule datum to a cell.

Promotion therefore requires a higher-resolution, unobscured top-down board reference or a human-reviewed transcription against the original physical board. Image optimisation improves delivery performance only; it does not increase the evidentiary resolution or turn decorative geometry into rules data.

## Comparison-image forensic findings

The supplied browser comparison image is useful as a failure report, but not as board evidence. It shows a dense rectangular 13-row shell with repeated `Unresolved` labels and placeholder centre dots. The visible city and feature overlays are sparse development fixtures placed on top of that shell, so the image does not demonstrate the physical board's land/sea silhouette, disabled cells, printed feature inventory, or authoritative adjacency.

Its geometry problem must be fixed as a layout-system issue: all cells need one flat-top landscape orientation; horizontal pitch must be derived from the tile width and shared-edge relationship; vertical pitch must be derived from tile height; and odd-row staggering must be applied once at row level. Per-cell rotation followed by a compensating whole-board rotation, negative margins, or independent hand-tuned offsets can make the bounding boxes overlap and the rows stack incorrectly. The acceptance comparison must therefore check the same fit state and aspect ratio for shared edges, row pitch, tile containment, label/piece containment, and absence of unintended intersections.

## Promotion checklist

- [ ] Assign every photographed cell a reviewed label or an explicit blank-space classification.
- [ ] Assign every cell its reviewed land, lake, sea, or seacoast class, keeping the thick blue printed line as the authoritative water-barrier boundary.
- [ ] Record every printed feature, including cities, bases, sites, lairs, Hollywood, Los Angeles, and special spaces.
- [ ] Review every reciprocal connection, water barrier, disabled edge, boundary, and exception.
- [ ] Attach an image-region reference to each non-obvious rule-bearing datum.
- [ ] Have a human reviewer sign off the generated coordinate table against both photographs.
- [ ] Regenerate the board content hash and require production validation to report zero unresolved rule-bearing fields.
- [ ] Wire the promoted board version into engine, API, browser, and MVP match fixtures.

Until every item is checked, this pack is evidence of the board reconstruction work—not approval to treat the candidate as a production or MVP board.
