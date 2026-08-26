# Provisional full-board transcription

This is a working transcription ledger for cross-referencing board photographs. It is not authoritative game data and must not be imported by the engine or used to promote the MVP board.

The ledger intentionally gives every one of the 254 coordinate-shell cells a review record. `hypothesis-land-or-feature` and `hypothesis-sea-or-coast` are deliberately coarse guesses based on the visible colour field, not authoritative terrain. `covered-or-unreadable` is for cells obscured by a playing piece, stomp marker, card, glare, perspective, or insufficient resolution. A later reference may replace any provisional state.

- Primary reference: [full game setup photograph](../references/monsters-menace-america/components/board/full-game-setup.jpg)
- Cross-check reference: [full board top-down photograph](../references/monsters-menace-america/components/board/full-board-top-down.jpg)
- Independent cross-check: [separate photographed game-board setup](https://blugee.com/cdn/shop/files/Monsters-Menace-America-Board-Game-2_898x600.jpg?v=1711114433)
- Third cross-check: [another photographed board setup](https://i.ebayimg.com/00/s/MTYwMFgxNjAw/z/rtYAAOSw9fVmDcjE/%24_3.JPG)
- Close-up cross-check: [BoardGameGeek close-up board photograph](https://boardgamegeek.com/image/201674/monsters-menace-america)
- Coordinate shell: `FULL_HONEYCOMB_BOARD`, 13 staggered rows, 254 cells
- Promotion rule: no provisional guess in this file changes `packages/game-engine/src/board.ts` or clears production validation.

## Candidate hypotheses to test against another reference

These are board-level hypotheses only, not cell assignments: the visible outer blue regions are sea/coast; the green interior is land; grey city panels carry printed city names and bonus values; bright yellow/orange panels are Infamy sites; star symbols are military bases; purple/pink panels are Mutation sites; Hollywood and Los Angeles are visible in the southwest. Each hypothesis requires a cell-level cross-check before promotion.

## Category correction from the four supplied photos

The supplied photos provide a stronger visual classification than the earlier broad pass. Treat the grey skyline panels as cities, not the yellow/orange panels. The yellow/orange panels repeatedly carry `INFAMY` and are Infamy sites. The repeated star symbols are military bases. The grey city panels visibly use bonus labels such as `1hp`, `2d`, and `3d`; those are the panels to inspect when assigning city bonuses. Purple/pink `MUTATE` panels are Mutation sites. This correction supersedes the earlier hypothesis that some yellow/orange panels might be bases.

## New straight-on full-board reference

The newly supplied straight-on photograph is substantially better for tile matching than the earlier angled/cropped images. It shows the complete board frame, the full staggered hex field, the Great Lakes, both coasts, the grey city panels, Infamy panels, Mutation panels, and most coloured base stars in one view. Use it as the primary alignment reference for the next coordinate pass. The lower legend, pieces, and a small number of bottom-edge cells still obscure some artwork, so exact assignments remain provisional until the shell overlay is checked against this image.

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
| Los Angeles | Roll 3 dice (inferred from development marker and major-city scale) | Existing development fixture uses `3D`; Hollywood/L.A. area is visibly present, but exact city cell remains unverified. | low-medium for region; low for bonus/cell | Keep Hollywood and Los Angeles as separate candidate spaces. |
| Chicago | +2 Health (inferred from development marker and major-city scale) | Existing development fixture uses `2HP`; physical-board mapping remains unverified. | low | Use only as a provisional search hypothesis. |
| New York | Roll at least 2 dice (corrected provisional inference) | Major-city scale makes the earlier 1-die guess too low; the physical-board value remains unread. | medium-low for bonus; low for shell coordinate | Keep as a corrected hypothesis until the printed New York panel is confirmed. |
| Philadelphia | Roll 2 dice (provisional inference) | Visible/evident east-coast city candidate adjacent to New York; major-city scale suggests it should not be a 1-die city. | low-medium for bonus; low for shell coordinate | Add as a separate city candidate beside New York; confirm against the physical panel. |
| Miami | No city bonus assigned; Challenge-site candidate | Existing development fixture classifies Miami as Challenge rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Denver | No city bonus assigned; military-base candidate | Existing development fixture classifies Denver as a base rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Dallas | No city bonus assigned; Mutation-site candidate | Existing development fixture classifies Dallas as a Mutation site rather than city. | low for physical board | Keep separate from the city-bonus list until the printed space is verified. |
| Boston, Washington, Houston, Atlanta, New Orleans, Toronto, Salt Lake City, Phoenix | Unassigned | Plausible major-city search targets based on map geography, not yet read from the references. | low | Inspect only; do not invent a bonus until a city panel is visible. |

All bonuses above are provisional hypotheses. The game rules support fixed Health gains and one-, two-, or three-die city rolls, but these candidate values are not source-approved. The close-up proves that non-empty city panels exist in the central/northern board area, but perspective and cropping prevent a reliable conversion to `row / column` or axial keys. The next useful artifact is an aligned crop or a straight-on board photograph with the shell overlay visible.

## Bonus-first city inference

For this pass, the exact printed city name is secondary. A blurry skyline panel can still be recorded as a city candidate if its surrounding geography is recognisable and its bonus prefix is visible or reasonably inferable.

| Approximate region / orientation | Example city labels used only for orientation | Provisional bonus pattern | Confidence |
| --- | --- | --- | --- |
| Southeast interior | Atlanta / Nashville | Atlanta: roll 2 dice; Nashville: roll 1 die. | low-medium; bonus-first, names/cells provisional |
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

## Promoted playtest transcription for implementation handoff

The following is the current best-effort board dataset to implement for playtesting. It deliberately promotes the guesses into a concrete row/column handoff so another chat can build the board without reinterpreting this conversation. Row `0` is the northernmost shell row; columns are counted left-to-right within each staggered row. Convert these row/column pairs to the canonical axial keys at the implementation boundary. These assignments remain editable when the physical board arrives.

### Cities and provisional benefits

| Row / column | Orientation label | Benefit |
| --- | --- | --- |
| `1 / 2` | Seattle | `+1 Health` |
| `9 / 2` | San Francisco | `2D` |
| `11 / 4` | Los Angeles | `3D`; also the Los Angeles feature |
| `2 / 7` | Winnipeg | `+1 Health` |
| `3 / 8` | Minneapolis | `1D` |
| `5 / 8` | Omaha | `1D` |
| `6 / 8` | Kansas City | `+1 Health` |
| `3 / 13` | Chicago | `2D` |
| `4 / 17` | New York | `3D` |
| `5 / 16` | Philadelphia | `2D` |
| `7 / 13` | Atlanta | `1D` |
| `7 / 11` | Nashville | `1D` |

### Military bases

| Row / column | Branch |
| --- | --- |
| `0 / 2` | Navy |
| `1 / 9` | Air Force |
| `6 / 12` | Air Force |
| `9 / 11` | Air Force |
| `10 / 15` | Air Force |
| `6 / 18` | Marines |
| `7 / 17` | Marines |
| `8 / 17` | Marines |
| `7 / 14` | Army |
| `9 / 15` | Army |
| `10 / 10` | Navy |
| `11 / 13` | Navy |

No National Guard base is assigned from the available images. Do not add one merely because an orange/yellow mark is visible: those marks are Infamy panels, not bases.

### Other visible board features

| Row / column | Feature |
| --- | --- |
| `2 / 5`, `4 / 8`, `7 / 5`, `9 / 5`, `10 / 14` | Infamy site |
| `4 / 10`, `6 / 9`, `8 / 7` | Mutation site |
| `10 / 16` | Challenge site |
| `11 / 1` | Hollywood |

### Promoted terrain and topology assumptions

- Treat the visible 254-cell shell as playable hexes.
- Treat the outer blue boundary cells as `seacoast` and the interior green field as `land` until the actual coast cut-outs can be checked.
- Enable reciprocal neighbouring edges across the shell with no barrier for the initial playtest. The later physical-board pass must replace this with the actual sea, lake, seacoast, disabled, and exceptional-edge topology.
- Keep every feature on its listed cell. Cells hidden by a stomp or playing piece were not added unless a second reference made the feature clear.
- Keep this section as the implementation input; the supplied straight-on physical-board photo confirms the three corrected values above. The provisional board definition is now version 2 with ruleset `playtest-0.3-physical-board-values`; coordinates, terrain, barriers, and the remaining unaligned features stay provisional.

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

The independent setup image confirms the board family, filled honeycomb extent, blue sea/coast boundary, green land field, Hollywood area, city panels, site markers, bases, and the general distribution of printed spaces. It does not resolve exact shell-cell assignments because its perspective, component placement, and lower-resolution presentation obscure or shift many cells. It therefore raises confidence in broad visual classifications but leaves feature coordinates and benefits provisional.

The third setup image is especially useful for the central, eastern, and southern board areas because it shows more printed map surface under a different arrangement of pieces and cards. It independently supports the broad land/sea silhouette and the presence of the same feature families. It still does not provide a geometrically aligned, unobscured cell-by-cell source, so terrain confidence can increase while feature confidence remains low.

The close-up BoardGameGeek photograph materially improves feature-level evidence: it shows readable printed city names and health-style values, repeated Infamy panels, Mutation markers, military-base artwork, Challenge-style star markers, and the placement relationship between printed spaces and military units. This raises confidence in the feature vocabulary and visible text patterns, but not in the axial-coordinate mapping because the photograph is a perspective crop without the full shell visible.

## Ocean line and coastal-water note

The photographed board shows an irregular ocean boundary rather than a rectangular outer border. The thick blue printed line is the authoritative water barrier: monsters without the appropriate ability cannot cross it. Record the ocean line as three connected coastal regions: the Pacific coast along the western edge, the Gulf coast wrapping the south-west/southern edge, and the Atlantic coast along the eastern edge. The visible blue cells immediately offshore are ocean/sea candidates; the land cells touching them are coastal cells and must not be collapsed into ordinary land. Great Lakes and other inland blue areas must be recorded separately as lake candidates, not as ocean.

For the next aligned transcription pass, trace the coastline cell by cell and then author the corresponding boundary edges. The current shell's edge-column `hypothesis-sea-or-coast` labels are only a review prompt: they do not represent the physical ocean line and must not be promoted as the final coastline.

## Obscured-cell assessment

The primary setup photograph is obscured most heavily across the southwest and south-central board by cards, reference sheets, dice, stomp markers, and playing pieces. The independent image exposes more of that underlying surface and uses a different piece layout, so it helps distinguish permanent printed artwork from temporary components. However, it still leaves some of the same lower-board cells covered and introduces perspective shift; it is not safe to transfer a visible marker to a shell coordinate by eye alone.

Result of the cross-check: no previously obscured cell has enough independent evidence to promote an exact label, city Health category, site type, base branch, lair, water class, or barrier. Those cells remain provisional in the ledger. Broad sea/coast versus land hypotheses are retained where both images agree; feature candidates remain `—` until a close, aligned reference or human physical-board review resolves them.

## Cell ledger

| Hex key | Row / column | Provisional visual state | Feature candidate | Terrain confidence | Feature confidence | Reference note |
| --- | --- | --- | --- | --- | --- |
| `0,0` | 0 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,0` | 0 / 1 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,0` | 0 / 2 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,0` | 0 / 3 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,0` | 0 / 4 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,0` | 0 / 5 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,0` | 0 / 6 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,0` | 0 / 7 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,0` | 0 / 8 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,0` | 0 / 9 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,0` | 0 / 10 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,0` | 0 / 11 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,0` | 0 / 12 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,0` | 0 / 13 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,0` | 0 / 14 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,0` | 0 / 15 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,0` | 0 / 16 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `17,0` | 0 / 17 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `18,0` | 0 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `19,0` | 0 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,1` | 1 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,1` | 1 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,1` | 1 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,1` | 1 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,1` | 1 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,1` | 1 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,1` | 1 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,1` | 1 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,1` | 1 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,1` | 1 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,1` | 1 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,1` | 1 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,1` | 1 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,1` | 1 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,1` | 1 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,1` | 1 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,1` | 1 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `17,1` | 1 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `18,1` | 1 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,2` | 2 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,2` | 2 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,2` | 2 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,2` | 2 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,2` | 2 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,2` | 2 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,2` | 2 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,2` | 2 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,2` | 2 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,2` | 2 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,2` | 2 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,2` | 2 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,2` | 2 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,2` | 2 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,2` | 2 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,2` | 2 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,2` | 2 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,2` | 2 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `17,2` | 2 / 18 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `18,2` | 2 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,3` | 3 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,3` | 3 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,3` | 3 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,3` | 3 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,3` | 3 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,3` | 3 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,3` | 3 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,3` | 3 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,3` | 3 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,3` | 3 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,3` | 3 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,3` | 3 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,3` | 3 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,3` | 3 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,3` | 3 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,3` | 3 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,3` | 3 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,3` | 3 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `17,3` | 3 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,4` | 4 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,4` | 4 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,4` | 4 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,4` | 4 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,4` | 4 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,4` | 4 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,4` | 4 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,4` | 4 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,4` | 4 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,4` | 4 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,4` | 4 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,4` | 4 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,4` | 4 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,4` | 4 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,4` | 4 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,4` | 4 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,4` | 4 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,4` | 4 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,4` | 4 / 18 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `17,4` | 4 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,5` | 5 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,5` | 5 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,5` | 5 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,5` | 5 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,5` | 5 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,5` | 5 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,5` | 5 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,5` | 5 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,5` | 5 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,5` | 5 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,5` | 5 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,5` | 5 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,5` | 5 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,5` | 5 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,5` | 5 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,5` | 5 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,5` | 5 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,5` | 5 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,5` | 5 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,6` | 6 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,6` | 6 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,6` | 6 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,6` | 6 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,6` | 6 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,6` | 6 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,6` | 6 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,6` | 6 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,6` | 6 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,6` | 6 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,6` | 6 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,6` | 6 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,6` | 6 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,6` | 6 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,6` | 6 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,6` | 6 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,6` | 6 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,6` | 6 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,6` | 6 / 18 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `16,6` | 6 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,7` | 7 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,7` | 7 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,7` | 7 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,7` | 7 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,7` | 7 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,7` | 7 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,7` | 7 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,7` | 7 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,7` | 7 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,7` | 7 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,7` | 7 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,7` | 7 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,7` | 7 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,7` | 7 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,7` | 7 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,7` | 7 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,7` | 7 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,7` | 7 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,7` | 7 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-4,8` | 8 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,8` | 8 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,8` | 8 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,8` | 8 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,8` | 8 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,8` | 8 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,8` | 8 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,8` | 8 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,8` | 8 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,8` | 8 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,8` | 8 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,8` | 8 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,8` | 8 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,8` | 8 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,8` | 8 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,8` | 8 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,8` | 8 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,8` | 8 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,8` | 8 / 18 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `15,8` | 8 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-4,9` | 9 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,9` | 9 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,9` | 9 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,9` | 9 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,9` | 9 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,9` | 9 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,9` | 9 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,9` | 9 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,9` | 9 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,9` | 9 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,9` | 9 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,9` | 9 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,9` | 9 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,9` | 9 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,9` | 9 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,9` | 9 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,9` | 9 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,9` | 9 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,9` | 9 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-5,10` | 10 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-4,10` | 10 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,10` | 10 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,10` | 10 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,10` | 10 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,10` | 10 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,10` | 10 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,10` | 10 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,10` | 10 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,10` | 10 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,10` | 10 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,10` | 10 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,10` | 10 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,10` | 10 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,10` | 10 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,10` | 10 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,10` | 10 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,10` | 10 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,10` | 10 / 18 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `14,10` | 10 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-5,11` | 11 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-4,11` | 11 / 1 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,11` | 11 / 2 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,11` | 11 / 3 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,11` | 11 / 4 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,11` | 11 / 5 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,11` | 11 / 6 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,11` | 11 / 7 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,11` | 11 / 8 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,11` | 11 / 9 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,11` | 11 / 10 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,11` | 11 / 11 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,11` | 11 / 12 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,11` | 11 / 13 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,11` | 11 / 14 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,11` | 11 / 15 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,11` | 11 / 16 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,11` | 11 / 17 | hypothesis-land-or-feature | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,11` | 11 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-6,12` | 12 / 0 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-5,12` | 12 / 1 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-4,12` | 12 / 2 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-3,12` | 12 / 3 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-2,12` | 12 / 4 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `-1,12` | 12 / 5 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `0,12` | 12 / 6 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `1,12` | 12 / 7 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `2,12` | 12 / 8 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `3,12` | 12 / 9 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `4,12` | 12 / 10 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `5,12` | 12 / 11 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `6,12` | 12 / 12 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `7,12` | 12 / 13 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `8,12` | 12 / 14 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `9,12` | 12 / 15 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `10,12` | 12 / 16 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `11,12` | 12 / 17 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `12,12` | 12 / 18 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |
| `13,12` | 12 / 19 | hypothesis-sea-or-coast | — | medium (broad visual field) | low for exact coordinate; medium for visible feature vocabulary | Compare all five references; exact feature placement remains unverified. |

## Cross-reference workflow

1. Add a second reference image and record its path in the relevant row's reference note.
2. Replace a hypothesis with `observed-land`, `observed-sea`, `observed-lake`, `observed-feature`, or `covered-or-unreadable` only when the image supports that distinction.
3. Record a guessed feature as `hypothesis:<type>` rather than silently treating it as observed.
4. Promote a cell only after its label, water class, features, source reference, and reciprocal edges have been reviewed.
