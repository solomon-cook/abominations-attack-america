# Card catalogue report

This report is generated from `packages/game-engine/src/cards.ts`. It describes the `prototype-0.1` development ruleset only; it is not production approval while the physical board and source-gated card effects remain unresolved.

- Card data version: 1
- Total source-inventoried cards: 32
- Available in the selected development ruleset: 29
- Source-gated and unavailable: 3

## Available cards

| Deck | Card | Classification | Effect status |
| --- | --- | --- | --- |
| mutation | Fins and Gills | persistent | implemented |
| mutation | Rampage | persistent | implemented |
| mutation | Radiation Field | persistent | implemented |
| mutation | Atomic Recovery | persistent | implemented |
| mutation | Berserk | one-use/discard | implemented |
| mutation | War Spikes | persistent | implemented |
| mutation | Atomic Breath | persistent | implemented |
| mutation | Iron Stomach | persistent | implemented |
| mutation | Whip Tentacles | persistent | implemented |
| mutation | High-Octane Blood | persistent | implemented |
| mutation | Son of a Monster | one-use/discard | implemented |
| mutation | Winged Horror | persistent | implemented |
| mutation | Kinda Friendly | persistent | implemented |
| mutation | Laser Beam Eyes | persistent | implemented |
| mutation | Armored Scales | persistent | implemented |
| mutation | It's a Robot! | persistent | implemented |
| research | Mecha-Monster | one-use/discard | implemented |
| research | Laser Fence | one-use/discard | implemented |
| research | Guard Commander | persistent | implemented |
| research | Defense Satellites | one-use/discard | implemented |
| research | Stabilizer Ray | one-use/discard | implemented |
| research | Fusion Cells | persistent | implemented |
| research | X-Fighters | persistent | implemented |
| research | 2nd Generation | persistent | implemented |
| research | Blonde Lure | one-use/discard | implemented |
| research | Anti-Mutagen | conditional | implemented |
| research | Antimatter | one-use/discard | implemented |
| research | Scientific Analysis | conditional | implemented |
| research | Captain Colossal | one-use/discard | implemented |

## Source-gated cards

These cards are rejected by `assertCardsAvailable` and cannot silently no-op in a selected ruleset.

| Deck | Card | Source status |
| --- | --- | --- |
| research | Cutbacks | source-gated |
| research | Molecular Cannon | source-gated |
| research | Chopper Lift | source-gated |

## Promotion boundary

The report intentionally does not claim zero unsupported cards for production. Production selection remains blocked until every source-gated effect, Challenge giant-unit lifecycle, and authoritative board datum has been independently verified and implemented.
