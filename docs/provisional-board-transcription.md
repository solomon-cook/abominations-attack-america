# Provisional full-board transcription

This is a working transcription ledger for cross-referencing board photographs. It is not authoritative game data and must not be imported by the engine or used to promote the MVP board.

The ledger intentionally gives every one of the 336 coordinate-shell cells a review record. The shell is a full 24-column by 14-row rectangle; edge cells remain present even when they are empty, sea, cropped, or covered in the photograph. `hypothesis-land-or-feature` and `hypothesis-sea-or-coast` are deliberately coarse guesses based on the visible colour field, not authoritative terrain. `covered-or-unreadable` is for cells obscured by a playing piece, stomp marker, card, glare, perspective, or insufficient resolution. A later reference may replace any provisional state.

- Primary reference: [user-supplied full board photograph](../references/monsters-menace-america/components/source-photos-2026-08-26/full-board-setup.JPG)
- Cross-check reference: [earlier full board top-down photograph](../references/monsters-menace-america/components/board/full-board-top-down.jpg)
- Independent cross-check: [separate photographed game-board setup](https://blugee.com/cdn/shop/files/Monsters-Menace-America-Board-Game-2_898x600.jpg?v=1711114433)
- Third cross-check: [another photographed board setup](https://i.ebayimg.com/00/s/MTYwMFgxNjAw/z/rtYAAOSw9fVmDcjE/%24_3.JPG)
- Close-up cross-check: [BoardGameGeek close-up board photograph](https://boardgamegeek.com/image/201674/monsters-menace-america)
- Coordinate shell: `FULL_HONEYCOMB_BOARD`, 14 rows of 24 cells, 336 cells, full photographed rectangle
- Coordinate aid convention: generated overlay labels are centred inside candidate hex faces; they are not printed board labels and must not be read from a shared vertex or edge
- Promotion rule: no provisional guess in this file changes `packages/game-engine/src/board.ts` or clears production validation.

## Candidate hypotheses to test against another reference

These are board-level hypotheses only, not cell assignments: the visible outer blue regions are sea/coast; the green interior is land; grey city panels carry printed city names and bonus values; bright yellow/orange panels are Infamy sites; star symbols are military bases; purple/pink panels are Mutation sites; the Hollywood area overlay and Los Angeles city are visible in the southwest. Each hypothesis requires a cell-level cross-check before promotion.

## Category correction from the four supplied photos

The supplied photos provide a stronger visual classification than the earlier broad pass. Treat the grey skyline panels as cities, not the yellow/orange panels. The yellow/orange panels repeatedly carry `INFAMY` and are Infamy sites. The repeated star symbols are military bases. The grey city panels visibly use bonus labels such as `1hp`, `2d`, and `3d`; those are the panels to inspect when assigning city bonuses. Purple/pink `MUTATE` panels are Mutation sites. This correction supersedes the earlier hypothesis that some yellow/orange panels might be bases.

## New straight-on full-board reference

The newly supplied straight-on photograph is substantially better for tile matching than the earlier angled/cropped images. It shows the complete board frame, the full staggered hex field, the Great Lakes, both coasts, the grey city panels, Infamy panels, Mutation panels, and most coloured base stars in one view. Use it as the primary alignment reference for the next coordinate pass. The lower legend, pieces, and a small number of bottom-edge cells still obscure some artwork, so exact assignments remain provisional until the shell overlay is checked against this image.

## Confirmed face-centre corrections in the current candidate pass

The aligned overlay resolves the northwest city cluster as Vancouver `0/3`, Seattle `1/3`, and Portland `2/2`; the nearby `0/2`, `1/1`, and `1/2` references are not the printed city faces. The western cluster additionally resolves Fresno `6/2`, Salt Lake City `5/6`, Los Angeles `8/2`, San Diego `9/2`, Phoenix `8/5`, and Albuquerque `8/8`. Winnipeg is at `2/12`. These are still candidate-board assignments rather than production sign-off, but they are based on the printed panel being inside the corresponding face, not on a nearby shared label.

## Provisional city-candidate pass

This pass marks likely city text or major-city regions for the next aligned review. These are hypotheses, not production labels or benefits.

| Candidate | Provisional bonus | Basis | Confidence | Current action |
| --- | --- | --- | --- | --- |
| Winnipeg | +1 Health (tentative visual read) | City panel is readable in the close-up photograph and appears to show `1hp`. | medium for bonus; low for shell coordinate | Keep as an unmapped city candidate until the close-up is aligned to the full shell. |
| Minneapolis | Roll 1 die (tentative visual read) | City panel is readable in the close-up photograph and appears to show a one-die marker. | medium-low for bonus; low for shell coordinate | Cross-check against a straight-on reference before promotion. |
| Omaha | Roll 1 die (tentative visual read) | City panel appears to show a one-die marker in the close-up photograph. | medium-low for bonus; low for shell coordinate | Cross-check against the third setup image before assigning. |
| Kansas City | +1 Health (inferred) | Central-plains city panel appears readable or strongly suggested; smaller printed city treatment is assumed provisionally. | low-medium for bonus; low for shell coordinate | Treat as a candidate only; correct when the physical board is available. |
| Seattle | +1 Health (inferred from development marker and city scale) | Existing development fixture uses `1HP`; physical-board mapping remains unverified. | low | Use only as a provisional search hypothesis. |
| San Francisco | Roll 2 dice (inferred from development marker and major-city scale) | Existing development fixture uses `2D`; physical-board mapping remains unverified. | low | Use only as a provisional search hypothesis. |
| Los Angeles | Roll 3 dice (inferred from development marker and major-city scale) | Existing development fixture uses `3D`; the Hollywood area overlay and L.A. city are visibly present, but exact city cell remains unverified. | low-medium for region; low for bonus/cell | Keep Hollywood as a non-visitable overlay and Los Angeles as the visitable city candidate. |
| Chicago | +2 Health (inferred from development marker and major-city scale) | Existing development fixture uses `2HP`; physical-board mapping remains unverified. | low | Use only as a provisional search hypothesis. |
| New York | Roll at least 2 dice (corrected provisional inference) | Major-city scale makes the earlier 1-die guess too low; the physical-board value remains unread. | medium-low for bonus; low for shell coordinate | Keep as a corrected hypothesis until the printed New York panel is confirmed. |
| Philadelphia | Roll 2 dice (provisional inference) | Visible/evident east-coast city candidate adjacent to New York; major-city scale suggests it should not be a 1-die city. | low-medium for bonus; low for shell coordinate | Add as a separate city candidate beside New York; confirm against the physical panel. |
| Miami | No city bonus assigned; Challenge-site candidate | Existing development fixture classifies Miami as Challenge rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Denver | No city bonus assigned; military-base candidate | Existing development fixture classifies Denver as a base rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Dallas | No city bonus assigned; Mutation-site candidate | Existing development fixture classifies Dallas as a Mutation site rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Boston, Washington, Houston, Atlanta, New Orleans, Toronto, Salt Lake City, Phoenix | Unassigned | Plausible major-city search targets based on map geography, not yet read from the references. | low | Inspect only; do not invent a bonus until a city panel is visible. |

## Current aligned city inventory (playtest, not sign-off)

The following table is generated from the current photo-aligned playtest board. It is included to make omissions visible; every row remains provisional until a human checks the physical board against the coordinate overlay.

| City | Row / column | Printed-value transcription | Axial key |
| --- | --- | --- | --- |
| Vancouver | 0 / 3 | +1 Health | 3,0 |
| Seattle | 1 / 3 | +1 Health | 3,1 |
| Portland | 2 / 2 | +1 Health | 1,2 |
| Winnipeg | 2 / 12 | +1 Health | 11,2 |
| Montreal | 2 / 21 | Roll 1 die | 20,2 |
| Minneapolis | 3 / 13 | Roll 1 die | 12,3 |
| Milwaukee | 3 / 15 | +1 Health | 14,3 |
| Ottawa | 3 / 20 | +1 Health | 19,3 |
| Chicago | 4 / 15 | Roll 2 dies | 13,4 |
| Detroit | 4 / 17 | Roll 2 dies | 15,4 |
| Toronto | 4 / 18 | Roll 1 die | 16,4 |
| New York | 4 / 21 | Roll 3 dies | 19,4 |
| Boston | 4 / 22 | Roll 2 dies | 20,4 |
| San Francisco | 5 / 1 | Roll 2 dies | -1,5 |
| Sacramento | 5 / 2 | +1 Health | 0,5 |
| Salt Lake City | 5 / 6 | +1 Health | 4,5 |
| Omaha | 5 / 12 | +1 Health | 10,5 |
| Pittsburgh | 5 / 19 | Roll 1 die | 17,5 |
| Philadelphia | 5 / 21 | Roll 2 dies | 19,5 |
| Fresno | 6 / 2 | +1 Health | -1,6 |
| Denver | 6 / 7 | Roll 1 die | 4,6 |
| Kansas City | 6 / 13 | +1 Health | 10,6 |
| St. Louis | 6 / 15 | Roll 1 die | 12,6 |
| Indianapolis | 6 / 16 | +1 Health | 13,6 |
| Cincinnati | 6 / 17 | +1 Health | 14,6 |
| Cleveland | 6 / 18 | +1 Health | 15,6 |
| Baltimore | 6 / 20 | Roll 2 dies | 17,6 |
| Richmond | 7 / 19 | +1 Health | 16,7 |
| Washington | 7 / 20 | +1 Health | 17,7 |
| Los Angeles | 8 / 2 | Roll 3 dies | -2,8 |
| Phoenix | 8 / 5 | Roll 1 die | 1,8 |
| Albuquerque | 8 / 8 | +1 Health | 4,8 |
| Little Rock | 8 / 11 | Roll 1 die | 7,8 |
| Tulsa | 8 / 12 | Roll 1 die | 8,8 |
| Charlotte | 8 / 14 | +1 Health | 10,8 |
| Nashville | 8 / 16 | +1 Health | 12,8 |
| Atlanta | 8 / 17 | Roll 1 die | 13,8 |
| San Diego | 9 / 2 | Roll 1 die | -2,9 |
| Birmingham | 9 / 11 | Roll 1 die | 7,9 |
| Dallas | 9 / 12 | Roll 1 die | 8,9 |
| Austin | 10 / 12 | +1 Health | 7,10 |
| Baton Rouge | 10 / 14 | +1 Health | 9,10 |
| Houston | 11 / 12 | Roll 1 die | 7,11 |
| Miami | 11 / 18 | Roll 1 die | 13,11 |
| Tampa | 12 / 20 | Roll 1 die | 14,12 |

All bonuses above are provisional hypotheses. The game rules support fixed Health gains and one-, two-, or three-die city rolls, but these candidate values are not source-approved. The close-up proves that non-empty city panels exist in the central/northern board area, but perspective and cropping prevent a reliable conversion to `row / column` or axial keys. The next useful artifact is an aligned crop or a straight-on board photograph with the shell overlay visible.

## Provisional city/base co-location inventory

The authority photograph shows these city panels and coloured base stars inside the same fitted hex face. They are recorded as composable features, not as mutually exclusive alternatives.

| City | Row / column | Base branch |
| --- | --- | --- |
| Boston | 4 / 22 | Navy |
| Baltimore | 6 / 20 | Marines |
| Richmond | 7 / 19 | Army |
| Nashville | 8 / 16 | Army |
| Birmingham | 9 / 11 | Air Force |
| Austin | 10 / 12 | Army |
| Kansas City | 6 / 13 | Air Force |

The same photograph also shows shared site/base faces at `7/4`, `9/6`, and `10/11` (Infamy plus Air Force), and at `10/19` (Cape Canaveral Infamy plus Navy).

## Provisional multi-base co-location inventory

The northeast crop shows two coloured base stars inside the same fitted face at `6/21`: yellow Air Force and blue Navy. Both are retained as separate military-base features. The wider aligned pass also retains the clearly visible base-only stars and the `10/16` Challenge-plus-Navy co-location in the cell ledger; obscured or seam-ambiguous stars remain unresolved.

| Row / column | Base branches |
| --- | --- |
| 6 / 21 | Air Force; Navy |

## Current aligned military-base inventory (playtest, not sign-off)

Each row below is one fitted face. Multiple branches in one row are separate printed base stars in the same hex; other gameplay features are shown to make co-locations visible.

| Row / column | Base branches | Other features | Axial key |
| --- | --- | --- | --- |
| 1 / 2 | Navy | — | 2,1 |
| 2 / 3 | Army | — | 2,2 |
| 2 / 10 | Air Force | — | 9,2 |
| 4 / 20 | Army | — | 18,4 |
| 4 / 22 | Navy | city | 20,4 |
| 6 / 12 | Army | — | 9,6 |
| 6 / 13 | Air Force | city | 10,6 |
| 6 / 20 | Marines | city | 17,6 |
| 6 / 21 | Air Force; Navy | — | 18,6 |
| 7 / 3 | Marines | — | 0,7 |
| 7 / 4 | Air Force | infamy-site | 1,7 |
| 7 / 14 | Army | — | 11,7 |
| 7 / 16 | Marines | — | 13,7 |
| 7 / 19 | Army | city | 16,7 |
| 7 / 21 | Marines | — | 18,7 |
| 8 / 4 | Marines | — | 0,8 |
| 8 / 16 | Army | city | 12,8 |
| 8 / 20 | Marines | — | 16,8 |
| 9 / 3 | Marines | — | -1,9 |
| 9 / 4 | Marines | — | 0,9 |
| 9 / 6 | Air Force | infamy-site | 2,9 |
| 9 / 11 | Air Force | city | 7,9 |
| 9 / 13 | Air Force | — | 9,9 |
| 9 / 15 | Army | — | 11,9 |
| 9 / 19 | Marines | — | 15,9 |
| 10 / 10 | Navy | — | 5,10 |
| 10 / 11 | Air Force | infamy-site | 6,10 |
| 10 / 12 | Army | city | 7,10 |
| 10 / 15 | Air Force | — | 10,10 |
| 10 / 16 | Navy | challenge-site | 11,10 |
| 10 / 17 | Air Force | — | 12,10 |
| 10 / 19 | Navy | infamy-site | 14,10 |
| 11 / 11 | Navy | — | 6,11 |
| 11 / 13 | Navy | — | 8,11 |

## Bonus-first city inference

For this pass, the exact printed city name is secondary. A blurry skyline panel can still be recorded as a city candidate if its surrounding geography is recognisable and its bonus prefix is visible or reasonably inferable.

| Approximate region / orientation | Example city labels used only for orientation | Provisional bonus pattern | Confidence |
| --- | --- | --- | --- |
| Southeast interior | Atlanta / Nashville | Atlanta: `1d`; Nashville: `1hp`. | medium for printed values; names/cells provisional |
| Northeast corridor | New York / Philadelphia / Boston | New York: at least 2 dice; Philadelphia: 2 dice; Boston: 1–2 dice pending panel read. | low-medium |
| Great Lakes | Chicago / Detroit / Cleveland / Toronto | Larger skyline panels: 2–3 dice; smaller neighbouring panels: 1 die or +2 Health. | low |
| Central plains | Minneapolis / Omaha / Kansas City | Minneapolis: 1 die; Omaha: 1 die; Kansas City: +1 Health. | medium-low |
| Pacific and southwest | Seattle / San Francisco / Los Angeles | Seattle: +1 Health; San Francisco: 2 dice; Los Angeles: 3 dice. | low-medium |
| Gulf and southern coast | Houston / New Orleans / Miami | Use 1 Health or 1 die for smaller-looking panels; reserve 2 dice for the clearly larger skyline panels. | low |

These are deliberately approximate bonus assignments, not claims that every named city has been located. When a later photo shows the grey panel's printed prefix, keep the bonus even if the guessed city name changes. Do not use the bright yellow/orange Infamy panels or star bases as city-bonus evidence.

## Provisional military-base star matching

The four supplied photos are sufficient to classify the visible coloured star symbols using the original branch-piece colour key. This is a provisional tile pass: the photos show overlapping/cropped regions, so the entries below use visual regions rather than pretending to have exact axial keys.

| Visible star branch | Provisional tile/region matches | Confidence |
| --- | --- | --- |
| Air Force | Yellow stars across the upper-central board, central interior, lower-central board, and eastern/southeastern coast. | medium for branch; low for exact shell key |
| Marines | Red stars clustered along the eastern seaboard and additional red-star coastal/southern candidates. | medium for branch; low for exact shell key |
| Navy | Blue star/base candidates around the Great Lakes, lower Mississippi/Gulf area, and coastal water-adjacent tiles. | medium for branch; low for exact shell key |
| Army | Green/olive star candidates in inland central and eastern interior tiles. | low-medium for branch; low for exact shell key |
| National Guard | Orange star candidates where the star is orange rather than yellow; none is yet clear enough in the supplied crops for an exact tile assignment. | low for branch; low for exact shell key |

Do not confuse these stars with the bright yellow/orange `INFAMY` panels or with the grey skyline city panels. The branch classification is useful for the next aligned overlay, but no base branch or star position is promoted into `FULL_HONEYCOMB_BOARD` yet.

## Straight-on photo: unobscured base candidates

The new straight-on photograph makes the following unobscured star positions usable as provisional base candidates. Row/column values are approximate image-grid positions: row 0 is the top board row and column 0 is the leftmost position in that row. Stomp-covered or piece-covered stars are intentionally omitted.

| Approx. row / column | Provisional branch | Evidence | Confidence |
| --- | --- | --- | --- |
| 0 / 2 | Navy | Blue star near the northwest/Pacific edge. | medium |
| 1 / 9 | Air Force | Yellow star in the upper-central interior. | medium |
| 6 / 12 | Air Force | Yellow star in the central-eastern interior. | medium |
| 9 / 11 | Air Force | Yellow star in the lower-central interior. | medium |
| 10 / 15 | Air Force | Yellow star near the Gulf/southeastern coast. | medium-low |
| 6 / 18 | Marines | Red star on the eastern coastal band. | medium |
| 7 / 17 | Marines | Red star on the eastern coastal band. | medium |
| 8 / 17 | Marines | Red star farther south on the eastern coastal band. | medium |
| 7 / 14 | Army | Green/olive star-like base in the eastern interior. | low-medium |
| 9 / 15 | Army | Green/olive star-like base in the lower eastern interior. | low-medium |
| 10 / 10 | Navy | Blue star/base near the Gulf/coastal transition. | low-medium |
| 11 / 13 | Navy | Blue star/base near the lower coastal water. | low-medium |
| — | National Guard | No unobscured orange star is clear enough in this photograph to add safely. | unresolved |

These positions are a provisional inventory for visual validation, not yet canonical `HexKey` assignments. The next pass should overlay the shell coordinates on the supplied straight-on photograph and either confirm or move each candidate by one cell where needed.

## Independent image comparison

The independent setup image confirms the board family, filled honeycomb extent, blue sea/coast boundary, green land field, Hollywood area overlay, city panels, site markers, bases, and the general distribution of printed spaces. It does not resolve exact shell-cell assignments because its perspective, component placement, and lower-resolution presentation obscure or shift many cells. It therefore raises confidence in broad visual classifications but leaves feature coordinates and benefits provisional.

The third setup image is especially useful for the central, eastern, and southern board areas because it shows more printed map surface under a different arrangement of pieces and cards. It independently supports the broad land/sea silhouette and the presence of the same feature families. It still does not provide a geometrically aligned, unobscured cell-by-cell source, so terrain confidence can increase while feature confidence remains low.

The close-up BoardGameGeek photograph materially improves feature-level evidence: it shows readable printed city names and health-style values, repeated Infamy panels, Mutation markers, military-base artwork, Challenge-style star markers, and the placement relationship between printed spaces and military units. This raises confidence in the feature vocabulary and visible text patterns, but not in the axial-coordinate mapping because the photograph is a perspective crop without the full shell visible.

## Ocean line and coastal-water note

The photographed board shows an irregular ocean boundary rather than a rectangular outer border. Record the ocean line as three connected coastal regions: the Pacific coast along the western edge, the Gulf coast wrapping the south-west/southern edge, and the Atlantic coast along the eastern edge. The visible blue cells immediately offshore are ocean/sea candidates; the land cells touching them are coastal cells and must not be collapsed into ordinary land. Great Lakes and other inland blue areas must be recorded separately as lake candidates, not as ocean.

For the next aligned transcription pass, trace the coastline cell by cell and then author the corresponding boundary edges. The current shell's edge-column `hypothesis-sea-or-coast` labels are only a review prompt: they do not represent the physical ocean line and must not be promoted as the final coastline.

## Obscured-cell assessment

The primary setup photograph is obscured most heavily across the southwest and south-central board by cards, reference sheets, dice, stomp markers, and playing pieces. The independent image exposes more of that underlying surface and uses a different piece layout, so it helps distinguish permanent printed artwork from temporary components. However, it still leaves some of the same lower-board cells covered and introduces perspective shift; it is not safe to transfer a visible marker to a shell coordinate by eye alone.

Result of the cross-check: no previously obscured cell has enough independent evidence to promote an exact label, city Health category, site type, base branch, lair, water class, or barrier. Those cells remain provisional in the ledger. Broad sea/coast versus land hypotheses are retained where both images agree; feature candidates remain `—` until a close, aligned reference or human physical-board review resolves them.

## Cell ledger

| Hex key | Row / column | Provisional visual state | Feature candidate | Terrain confidence | Feature confidence | Reference note |
| --- | --- | --- | --- | --- | --- |
| `0,0` | 0 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,0` | 0 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,0` | 0 / 2 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,0` | 0 / 3 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,0` | 0 / 4 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,0` | 0 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,0` | 0 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,0` | 0 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,0` | 0 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,0` | 0 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,0` | 0 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,0` | 0 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,0` | 0 / 12 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,0` | 0 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,0` | 0 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,0` | 0 / 15 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,0` | 0 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,0` | 0 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,0` | 0 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,0` | 0 / 19 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,0` | 0 / 20 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,0` | 0 / 21 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `22,0` | 0 / 22 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `23,0` | 0 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,1` | 1 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,1` | 1 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,1` | 1 / 2 | candidate-seacoast | military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,1` | 1 / 3 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,1` | 1 / 4 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,1` | 1 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,1` | 1 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,1` | 1 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,1` | 1 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,1` | 1 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,1` | 1 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,1` | 1 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,1` | 1 / 12 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,1` | 1 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,1` | 1 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,1` | 1 / 15 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,1` | 1 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,1` | 1 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,1` | 1 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,1` | 1 / 19 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,1` | 1 / 20 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,1` | 1 / 21 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `22,1` | 1 / 22 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `23,1` | 1 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,2` | 2 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,2` | 2 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,2` | 2 / 2 | candidate-seacoast | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,2` | 2 / 3 | candidate-land | military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,2` | 2 / 4 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,2` | 2 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,2` | 2 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,2` | 2 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,2` | 2 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,2` | 2 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,2` | 2 / 10 | candidate-land | military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,2` | 2 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,2` | 2 / 12 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,2` | 2 / 13 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,2` | 2 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,2` | 2 / 15 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,2` | 2 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,2` | 2 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,2` | 2 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,2` | 2 / 19 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,2` | 2 / 20 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,2` | 2 / 21 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,2` | 2 / 22 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `22,2` | 2 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,3` | 3 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,3` | 3 / 1 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,3` | 3 / 2 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,3` | 3 / 3 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,3` | 3 / 4 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,3` | 3 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,3` | 3 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,3` | 3 / 7 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,3` | 3 / 8 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,3` | 3 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,3` | 3 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,3` | 3 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,3` | 3 / 12 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,3` | 3 / 13 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,3` | 3 / 14 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,3` | 3 / 15 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,3` | 3 / 16 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,3` | 3 / 17 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,3` | 3 / 18 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,3` | 3 / 19 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,3` | 3 / 20 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,3` | 3 / 21 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,3` | 3 / 22 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `22,3` | 3 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,4` | 4 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,4` | 4 / 1 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,4` | 4 / 2 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,4` | 4 / 3 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,4` | 4 / 4 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,4` | 4 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,4` | 4 / 6 | candidate-land | mutation-site (experimental-breeder-reactor) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,4` | 4 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,4` | 4 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,4` | 4 / 9 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,4` | 4 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,4` | 4 / 11 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,4` | 4 / 12 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,4` | 4 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,4` | 4 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,4` | 4 / 15 | candidate-land | city (Roll 2 dies) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,4` | 4 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,4` | 4 / 17 | candidate-lake | city (Roll 2 dies) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,4` | 4 / 18 | candidate-lake | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,4` | 4 / 19 | candidate-lake | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,4` | 4 / 20 | candidate-land | military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,4` | 4 / 21 | candidate-land | city (Roll 3 dies) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,4` | 4 / 22 | candidate-seacoast | city (Roll 2 dies), military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,4` | 4 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,5` | 5 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,5` | 5 / 1 | candidate-seacoast | city (Roll 2 dies) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,5` | 5 / 2 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,5` | 5 / 3 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,5` | 5 / 4 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,5` | 5 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,5` | 5 / 6 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,5` | 5 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,5` | 5 / 8 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,5` | 5 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,5` | 5 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,5` | 5 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,5` | 5 / 12 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,5` | 5 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,5` | 5 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,5` | 5 / 15 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,5` | 5 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,5` | 5 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,5` | 5 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,5` | 5 / 19 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,5` | 5 / 20 | candidate-seacoast | mutation-site (three-mile-island) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,5` | 5 / 21 | candidate-seacoast | city (Roll 2 dies) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,5` | 5 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `21,5` | 5 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,6` | 6 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,6` | 6 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,6` | 6 / 2 | candidate-seacoast | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,6` | 6 / 3 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,6` | 6 / 4 | candidate-land | mutation-site (nevada-test-site) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,6` | 6 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,6` | 6 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,6` | 6 / 7 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,6` | 6 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,6` | 6 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,6` | 6 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,6` | 6 / 11 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,6` | 6 / 12 | candidate-land | military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,6` | 6 / 13 | candidate-land | city (+1 Health), military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,6` | 6 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,6` | 6 / 15 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,6` | 6 / 16 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,6` | 6 / 17 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,6` | 6 / 18 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,6` | 6 / 19 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,6` | 6 / 20 | candidate-seacoast | city (Roll 2 dies), military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,6` | 6 / 21 | candidate-seacoast | military-base (Air Force), military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,6` | 6 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,6` | 6 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,7` | 7 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,7` | 7 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,7` | 7 / 2 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,7` | 7 / 3 | candidate-land | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,7` | 7 / 4 | candidate-land | infamy-site, military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,7` | 7 / 5 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,7` | 7 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,7` | 7 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,7` | 7 / 8 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,7` | 7 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,7` | 7 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,7` | 7 / 11 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,7` | 7 / 12 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,7` | 7 / 13 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,7` | 7 / 14 | candidate-land | military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,7` | 7 / 15 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,7` | 7 / 16 | candidate-land | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,7` | 7 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,7` | 7 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,7` | 7 / 19 | candidate-land | city (+1 Health), military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,7` | 7 / 20 | candidate-seacoast | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,7` | 7 / 21 | candidate-seacoast | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,7` | 7 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `20,7` | 7 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,8` | 8 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,8` | 8 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,8` | 8 / 2 | candidate-seacoast | city (Roll 3 dies), los-angeles | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,8` | 8 / 3 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,8` | 8 / 4 | candidate-land | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,8` | 8 / 5 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,8` | 8 / 6 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,8` | 8 / 7 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,8` | 8 / 8 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,8` | 8 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,8` | 8 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,8` | 8 / 11 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,8` | 8 / 12 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,8` | 8 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,8` | 8 / 14 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,8` | 8 / 15 | candidate-land | infamy-site | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,8` | 8 / 16 | candidate-land | city (+1 Health), military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,8` | 8 / 17 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,8` | 8 / 18 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,8` | 8 / 19 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,8` | 8 / 20 | candidate-seacoast | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,8` | 8 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,8` | 8 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,8` | 8 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,9` | 9 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,9` | 9 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,9` | 9 / 2 | candidate-seacoast | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,9` | 9 / 3 | candidate-seacoast | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,9` | 9 / 4 | candidate-seacoast | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,9` | 9 / 5 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,9` | 9 / 6 | candidate-land | infamy-site, military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,9` | 9 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,9` | 9 / 8 | candidate-land | mutation-site (roswell) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,9` | 9 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,9` | 9 / 10 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,9` | 9 / 11 | candidate-land | city (Roll 1 die), military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,9` | 9 / 12 | candidate-land | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,9` | 9 / 13 | candidate-land | military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,9` | 9 / 14 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,9` | 9 / 15 | candidate-land | military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,9` | 9 / 16 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,9` | 9 / 17 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,9` | 9 / 18 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,9` | 9 / 19 | candidate-seacoast | military-base (Marines) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,9` | 9 / 20 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,9` | 9 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,9` | 9 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `19,9` | 9 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-5,10` | 10 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,10` | 10 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,10` | 10 / 2 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,10` | 10 / 3 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,10` | 10 / 4 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,10` | 10 / 5 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,10` | 10 / 6 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,10` | 10 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,10` | 10 / 8 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,10` | 10 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,10` | 10 / 10 | candidate-land | military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,10` | 10 / 11 | candidate-land | infamy-site, military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,10` | 10 / 12 | candidate-land | city (+1 Health), military-base (Army) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,10` | 10 / 13 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,10` | 10 / 14 | candidate-land | city (+1 Health) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,10` | 10 / 15 | candidate-seacoast | military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,10` | 10 / 16 | candidate-seacoast | challenge-site, military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,10` | 10 / 17 | candidate-seacoast | military-base (Air Force) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,10` | 10 / 18 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,10` | 10 / 19 | candidate-seacoast | infamy-site, military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,10` | 10 / 20 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,10` | 10 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,10` | 10 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,10` | 10 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-5,11` | 11 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,11` | 11 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,11` | 11 / 2 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,11` | 11 / 3 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,11` | 11 / 4 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,11` | 11 / 5 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,11` | 11 / 6 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,11` | 11 / 7 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,11` | 11 / 8 | candidate-land | lair (unresolved) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,11` | 11 / 9 | candidate-land | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,11` | 11 / 10 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,11` | 11 / 11 | candidate-seacoast | military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,11` | 11 / 12 | candidate-seacoast | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,11` | 11 / 13 | candidate-seacoast | military-base (Navy) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,11` | 11 / 14 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,11` | 11 / 15 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,11` | 11 / 16 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,11` | 11 / 17 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,11` | 11 / 18 | candidate-seacoast | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,11` | 11 / 19 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,11` | 11 / 20 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,11` | 11 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,11` | 11 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `18,11` | 11 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-6,12` | 12 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-5,12` | 12 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,12` | 12 / 2 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,12` | 12 / 3 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,12` | 12 / 4 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,12` | 12 / 5 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,12` | 12 / 6 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,12` | 12 / 7 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,12` | 12 / 8 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,12` | 12 / 9 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,12` | 12 / 10 | candidate-seacoast | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,12` | 12 / 11 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,12` | 12 / 12 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,12` | 12 / 13 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,12` | 12 / 14 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,12` | 12 / 15 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,12` | 12 / 16 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,12` | 12 / 17 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,12` | 12 / 18 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,12` | 12 / 19 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,12` | 12 / 20 | candidate-seacoast | city (Roll 1 die) | medium (aligned photo candidate) | medium-low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,12` | 12 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,12` | 12 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,12` | 12 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-6,13` | 13 / 0 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-5,13` | 13 / 1 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-4,13` | 13 / 2 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-3,13` | 13 / 3 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-2,13` | 13 / 4 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `-1,13` | 13 / 5 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `0,13` | 13 / 6 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `1,13` | 13 / 7 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `2,13` | 13 / 8 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `3,13` | 13 / 9 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `4,13` | 13 / 10 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `5,13` | 13 / 11 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `6,13` | 13 / 12 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `7,13` | 13 / 13 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `8,13` | 13 / 14 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `9,13` | 13 / 15 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `10,13` | 13 / 16 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `11,13` | 13 / 17 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `12,13` | 13 / 18 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `13,13` | 13 / 19 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `14,13` | 13 / 20 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `15,13` | 13 / 21 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `16,13` | 13 / 22 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |
| `17,13` | 13 / 23 | candidate-sea | — | medium (aligned photo candidate) | low pending source sign-off | Compare the face against the full-board photo; candidate data is not production verified. |

## Cross-reference workflow

1. Add a second reference image and record its path in the relevant row's reference note.
2. Replace a hypothesis with `observed-land`, `observed-sea`, `observed-lake`, `observed-feature`, or `covered-or-unreadable` only when the image supports that distinction.
3. Record a guessed feature as `hypothesis:<type>` rather than silently treating it as observed.
4. Promote a cell only after its label, water class, features, source reference, and reciprocal edges have been reviewed.
