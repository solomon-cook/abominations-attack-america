# Card catalogue report

This report is generated from `packages/game-engine/src/cards.ts`. All inventoried card effects are implemented in the `prototype-0.1` development ruleset; physical-board promotion and source/lifecycle review remain separate production gates.

- Card data version: 1
- Total source-inventoried cards: 32
- Available in the selected development ruleset: 32
- Source-gated and unavailable: 0

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
| research | Cutbacks | one-use/discard | source-gated | implemented |
| research | Laser Fence | one-use/discard | source-gated | implemented |
| research | Guard Commander | persistent | permission-or | implemented |
| research | Defense Satellites | one-use/discard | source-gated | implemented |
| research | Stabilizer Ray | one-use/discard | source-gated | implemented |
| research | Fusion Cells | persistent | additive | implemented |
| research | X-Fighters | persistent | source-gated | implemented |
| research | Molecular Cannon | one-use/discard | source-gated | implemented |
| research | 2nd Generation | persistent | additive | implemented |
| research | Blonde Lure | one-use/discard | source-gated | implemented |
| research | Anti-Mutagen | conditional | source-gated | implemented |
| research | Antimatter | one-use/discard | source-gated | implemented |
| research | Scientific Analysis | conditional | source-gated | implemented |
| research | Chopper Lift | one-use/discard | source-gated | implemented |
| research | Captain Colossal | one-use/discard | source-gated | implemented |

## Source-gated cards

These cards are rejected by `assertCardsAvailable` and cannot silently no-op in a selected ruleset.

| Deck | Card | Stacking policy | Source status |
| --- | --- | --- | --- |

## Promotion boundary

The report confirms zero unsupported cards in the selected development ruleset. Production selection remains separately blocked until the authoritative board and remaining source/lifecycle approvals are complete.
