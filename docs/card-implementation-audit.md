# Mutation and Military Research Card Audit

Audit date: 2026-09-20

All 32 inventoried cards are now marked `implemented` in the authoritative
catalogue. Persistent cards resolve through the shared effect projection;
conditional and one-shot cards resolve at their backend timing window. The
player's hand, the military/monster record sheets, and the phase command panel
provide the accessible card surfaces. Automatic effects are described in the
hand and surfaced in the event/result log instead of receiving a redundant
button.

## Monster Mutation cards

| Cards | Backend/UI status |
|---|---|
| Fins and Gills · Rampage · Radiation Field · Atomic Recovery | Implemented persistent effects; movement/combat selectors and turn transitions apply them; hand and record sheets expose their rules. |
| Berserk · Son of a Monster | Implemented one-shot battle actions; Fight controls and held-card buttons expose the optional timing. |
| War Spikes · Atomic Breath · Whip Tentacles · High-Octane Blood | Implemented automatic combat/Challenge effects; attack order, damage, and attack counts are authoritative and logged. |
| Iron Stomach | Implemented base-Encounter choice; the encounter choice UI exposes Health versus Infamy. |
| Winged Horror · Kinda Friendly | Implemented movement effects; legal path highlighting and movement resolution apply the effects. |
| Laser Beam Eyes · Armored Scales · It's a Robot! | Implemented conditional stat/combat/Challenge effects; modifiers and retaliation appear in authoritative combat results. |

## Military Research cards

| Cards | Backend/UI status |
|---|---|
| Defense Satellites | Implemented immediate action; exposed in the phase controls and held-card panel. |
| Antimatter · Stabilizer Ray · Laser Fence | Implemented battle-start actions; phase controls expose damage, Mutation target, or Infamy/retreat choices. |
| Guard Commander · Fusion Cells · 2nd Generation | Implemented persistent permissions/modifiers; legal movement/deployment selectors enforce them and record sheets show active status. |
| Mecha-Monster · Captain Colossal | Implemented placement, Health, destruction, and Challenge lifecycle; Research/deployment and Challenge controls expose choices. |
| X-Fighters | Implemented card lifecycle, two-piece creation, deployment substitution, and removal; Military Sheet exposes deployment. |
| Blonde Lure | Implemented target/destination selection and next-move constraint; dedicated board action exposes legal destinations. |
| Anti-Mutagen · Scientific Analysis | Implemented automatic battle-start damage; results/log identify the effect. |
| Cutbacks | Implemented card removal from play with a required Research-card choice; held-card controls expose the target. |
| Molecular Cannon | Implemented roll, damage, and assigned-lair destination; held-card controls expose monster/lair choices. |
| Chopper Lift | Implemented roll, distance validation, collision/terrain/site restrictions, movement, and Infamy loss; held-card controls expose monster/destination choices. |

## Toxicor choice

Toxicor no longer auto-keeps the first Mutation card. At a Mutation site the
backend draws two cards, persists a typed `mutation-choice` pending decision,
and the active player chooses one through labeled keyboard-accessible buttons.
The unchosen card is shuffled back into the live deck only after the choice;
projection redaction prevents other players from seeing the two card IDs.

The full-board topology and any source-gated physical promotion remain separate
release boundaries; they do not disable the card implementations in the current
development/provisional rulesets.
