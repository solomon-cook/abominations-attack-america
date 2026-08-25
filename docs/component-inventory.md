# Component inventory and source status

This is the source-audit inventory for a 2–4 player match. Counts describe the physical game reference captured in `references/monsters-menace-america/`; they do not claim that the corresponding production rules are implemented. The catalogue and photographs are internal reference material and are not cleared as shipped artwork.

## Inventory

| Category | Quantity | Coverage | Source/status |
| --- | ---: | --- | --- |
| Giant monster pieces | 6 | Gargantis, Konk, Megaclaw, Tomanagi, Toxicor, Zorb | Record-tile catalogue and source photographs captured; numeric stats, movement modes, and special text are typed in `packages/game-engine/src/monsters.ts`; lairs and effect execution remain source-gated |
| Monster record/reference tiles | 6 | One for each monster | Source photographs captured; exact lairs and all rule effects remain source-audit inputs |
| Regular military units | 40 | 8 each for Air Force, Army, Marines, Navy, National Guard | Branch record quantities and numeric unit data are typed in `packages/game-engine/src/units.ts`; movement exceptions, deployment, control, and combat effects remain source-gated |
| Black X-Fighters | 2 | Military Research-linked unit | Component category documented; card-linked placement/effect remains unresolved in the rules reference |
| Giant military units | 2 | Mecha-Monster, Captain Colossal | Record-tile catalogue, numeric data, and source references are typed; card placement rules remain unresolved |
| Military branch record/reference tiles | 5 | Air Force, Army, Marines, Navy, National Guard | Source photographs captured; deployment formulas require implementation fixtures |
| Monster Mutation cards | 16 unique cards | Complete named inventory and transcriptions in catalogue | Source-backed transcription captured; engine timing/stacking/deck behavior not implemented |
| Military Research cards | 16 unique cards | Complete named inventory and transcriptions in catalogue | Source-backed transcription captured; engine timing/stacking/deck behavior not implemented |
| Plastic Health/record sliders | 15 | Physical component count | Visible in setup reference; no isolated complete inventory photograph |
| Infamy tokens | 42 | Physical component count | Token reference photograph captured |
| Stomp markers | 23 | Physical component count | Marker reference photograph captured |
| Six-sided dice | 3 | Physical component count | Dice reference photograph captured |
| Board | 1 | Clean top-down and setup photographs | Geometry and every printed feature are not yet transcribed into production board data |
| Rulebook | 1 | Rendered local pages and structured reference | Rules reference exists; component-dependent facts remain in the unresolved inventory |

## Structured catalogue coverage

The machine-readable catalogue currently contains:

- 6/6 monsters;
- 5/5 military branches, including National Guard;
- 2/2 giant military units;
- 16/16 Military Research cards;
- 16/16 Monster Mutation cards.

The engine's source-backed monster catalogue independently records the six photographed monster records, including starting Health, Move, movement mode, Defense, Attacks, Damage, special-ability wording, and image references. This does not promote lair locations or special-ability execution to production.

The engine's source-backed unit catalogue independently records all branch unit quantities and photographed numeric data, plus the two giant-unit records and the two National Guard unit types. The development fixture instantiates all 32 regular branch units with conservation assertions; it does not enable production deployment, water movement, temporary control, card-linked launches, destruction timing, or other special effects.

The four branch deployment records are also typed from the photographed deployment text: Army, Navy, and Air Force place two own-or-Guard units plus one National Guard unit; Marines place three Marines-or-Guard units; each may draw one Military Research card instead. The deployment command still requires board, inventory, and control validation.

The catalogue's `uncertainty` fields are the transcription-quality record for each captured item. A zero-length uncertainty list means the cited image text was legible; it does not mean the engine has implemented or independently verified the rule interaction.

## Production boundary

No statistic, card effect, board coordinate, placement rule, or special-case interpretation is promoted to production solely because it appears in a photograph. Production promotion requires a source reference, a typed data record, an engine rule, and a focused test. The monster statistics now have the source-backed typed-data and catalogue-test portion; lairs and special-ability execution still fail that boundary. Missing or contradictory component evidence is listed in [the unresolved rules inventory](unresolved-rules-inventory.md).

## National Guard engine boundary

The engine now carries an explicit neutral National Guard inventory with `location: "record-tile"`, no player owner, and no instantiated unit IDs. Quantity and statistics remain `source-gated`; the model does not infer them from the photographed component count. The exact Guard Commander transcription is promoted in `SOURCED_CARD_RULES`, while National Guard movement, deployment, combat, and temporary control enforcement remain disabled until the full board/card lifecycle is implemented.
