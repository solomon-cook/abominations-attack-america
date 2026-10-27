# Card catalogue report

This report is generated from `packages/game-engine/src/cards.ts`. All inventoried card effects are implemented in the `prototype-0.1` development ruleset; physical-board promotion and source/lifecycle review remain separate production gates.

- Card data version: 1
- Total source-inventoried cards: 32
- Available in the selected development ruleset: 32
- Source-gated and unavailable: 0

## Available cards

Drawn cards are public face up under the original rulebook (p. 13); deck order and discard contents remain private.

| Deck | Card | Classification | Visibility | Stacking policy | Effect status |
| --- | --- | --- | --- | --- | --- |
| mutation | Fins and Gills | persistent | face-up public | additive | implemented |
| mutation | Rampage | persistent | face-up public | permission-or | implemented |
| mutation | Radiation Field | persistent | face-up public | source-gated | implemented |
| mutation | Atomic Recovery | persistent | face-up public | replacement | implemented |
| mutation | Berserk | one-use/discard | face-up public | additive | implemented |
| mutation | War Spikes | persistent | face-up public | replacement | implemented |
| mutation | Atomic Breath | persistent | face-up public | additive | implemented |
| mutation | Iron Stomach | persistent | face-up public | replacement | implemented |
| mutation | Whip Tentacles | persistent | face-up public | additive | implemented |
| mutation | High-Octane Blood | persistent | face-up public | additive | implemented |
| mutation | Son of a Monster | one-use/discard | face-up public | additive | implemented |
| mutation | Winged Horror | persistent | face-up public | additive | implemented |
| mutation | Kinda Friendly | persistent | face-up public | permission-or | implemented |
| mutation | Laser Beam Eyes | persistent | face-up public | additive | implemented |
| mutation | Armored Scales | persistent | face-up public | additive | implemented |
| mutation | It's a Robot! | persistent | face-up public | source-gated | implemented |
| research | Mecha-Monster | one-use/discard | face-up public | source-gated | implemented |
| research | Cutbacks | one-use/discard | face-up public | remove-from-play | implemented |
| research | Laser Fence | one-use/discard | face-up public | source-gated | implemented |
| research | Guard Commander | persistent | face-up public | permission-or | implemented |
| research | Defense Satellites | one-use/discard | face-up public | source-gated | implemented |
| research | Stabilizer Ray | one-use/discard | face-up public | source-gated | implemented |
| research | Fusion Cells | persistent | face-up public | additive | implemented |
| research | X-Fighters | persistent | face-up public | replacement | implemented |
| research | Molecular Cannon | one-use/discard | face-up public | source-gated | implemented |
| research | 2nd Generation | persistent | face-up public | additive | implemented |
| research | Blonde Lure | one-use/discard | face-up public | source-gated | implemented |
| research | Anti-Mutagen | conditional | face-up public | additive | implemented |
| research | Antimatter | one-use/discard | face-up public | source-gated | implemented |
| research | Scientific Analysis | conditional | face-up public | additive | implemented |
| research | Chopper Lift | one-use/discard | face-up public | source-gated | implemented |
| research | Captain Colossal | one-use/discard | face-up public | source-gated | implemented |

## Source-gated cards

These cards are rejected by `assertCardsAvailable` and cannot silently no-op in a selected ruleset.

| Deck | Card | Stacking policy | Source status |
| --- | --- | --- | --- |

## Promotion boundary

The report confirms zero unsupported cards in the selected development ruleset. Production selection remains separately blocked until the authoritative board and remaining source/lifecycle approvals are complete.
