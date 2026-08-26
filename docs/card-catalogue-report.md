# Card catalogue report

This report is generated from `packages/game-engine/src/cards.ts`. It describes the `prototype-0.1` development ruleset only; it is not production approval while the physical board and source-gated card effects remain unresolved.

- Card data version: 1
- Total source-inventoried cards: 32
- Available in the selected development ruleset: 29
- Source-gated and unavailable: 3

## Available cards

| Deck | Card | Classification | Stacking policy | Effect status |
| --- | --- | --- | --- | --- |
| mutation | Fins and Gills | persistent | additive | implemented |
| mutation | Rampage | persistent | source-gated | implemented |
| mutation | Radiation Field | persistent | source-gated | implemented |
| mutation | Atomic Recovery | persistent | source-gated | implemented |
| mutation | Berserk | one-use/discard | source-gated | implemented |
| mutation | War Spikes | persistent | replacement | implemented |
| mutation | Atomic Breath | persistent | additive | implemented |
| mutation | Iron Stomach | persistent | source-gated | implemented |
| mutation | Whip Tentacles | persistent | source-gated | implemented |
| mutation | High-Octane Blood | persistent | additive | implemented |
| mutation | Son of a Monster | one-use/discard | source-gated | implemented |
| mutation | Winged Horror | persistent | additive | implemented |
| mutation | Kinda Friendly | persistent | source-gated | implemented |
| mutation | Laser Beam Eyes | persistent | source-gated | implemented |
| mutation | Armored Scales | persistent | additive | implemented |
| mutation | It's a Robot! | persistent | source-gated | implemented |
| research | Mecha-Monster | one-use/discard | source-gated | implemented |
| research | Laser Fence | one-use/discard | source-gated | implemented |
| research | Guard Commander | persistent | permission-or | implemented |
| research | Defense Satellites | one-use/discard | source-gated | implemented |
| research | Stabilizer Ray | one-use/discard | source-gated | implemented |
| research | Fusion Cells | persistent | additive | implemented |
| research | X-Fighters | persistent | source-gated | implemented |
| research | 2nd Generation | persistent | additive | implemented |
| research | Blonde Lure | one-use/discard | source-gated | implemented |
| research | Anti-Mutagen | conditional | source-gated | implemented |
| research | Antimatter | one-use/discard | source-gated | implemented |
| research | Scientific Analysis | conditional | source-gated | implemented |
| research | Captain Colossal | one-use/discard | source-gated | implemented |

## Source-gated cards

These cards are rejected by `assertCardsAvailable` and cannot silently no-op in a selected ruleset.

| Deck | Card | Stacking policy | Source status |
| --- | --- | --- | --- |
| research | Cutbacks | source-gated | source-gated |
| research | Molecular Cannon | source-gated | source-gated |
| research | Chopper Lift | source-gated | source-gated |

## Promotion boundary

The report intentionally does not claim zero unsupported cards for production. Production selection remains blocked until every source-gated effect, Challenge giant-unit lifecycle, and authoritative board datum has been independently verified and implemented.
