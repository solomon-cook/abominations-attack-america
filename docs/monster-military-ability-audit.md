# Monster and Military Ability Audit

Audit date: 2026-09-20

Scope: printed abilities on the six monster records, regular military records,
the National Guard record/card, and the giant-unit records. Mutation and
Military Research cards are separate systems and are only included where a
record ability depends on them.

## Summary

All record abilities are represented in the authoritative game engine and all
player-action abilities have an in-game control. Automatic abilities are
resolved by the engine at the timing boundary where no button is appropriate.
The implementation is complete for the current development/provisional
rulesets; the physical-board promotion and unresolved source lifecycle remain
release gates documented in `docs/unresolved-rules-inventory.md`.

## Monster records

| Ability | Backend implementation | User-facing affordance | Evidence |
|---|---|---|---|
| Zorb: choose 2 Infamy instead of city Health | `resolveEncounterResult` creates a typed `encounter-choice` and applies the selected result | Encounter overlay and Phase Actions show “Take 2 Infamy” or Health at the choice timing | `index.test.ts`: “Zorb city encounter exposes and applies its source-backed benefit choice” |
| Tomanagi: +1 attack in round one at sea/coast | `effectiveMonsterAttacks` adds the attack only for round one in a sea/coast space | No action needed; the battle surface/log reports the resulting attack sequence | `index.test.ts`: “Tomanagi gets one extra first-round attack in sea combat only” |
| Gargantis: discard Mutation cards for +3 Health | `use-monster-ability` validates controller, cards, timing, discard, cap, and healing | Held Mutation cards expose “Gargantis: discard for +3 Health” when legal | `index.test.ts`: “Gargantis can discard one or more Mutation cards for three Health each” |
| Megaclaw: +3 Infamy at an Infamy site | Encounter resolution applies the exception and caps at 15 | Encounter result shows the authoritative Infamy reward | `index.test.ts`: “Megaclaw receives its source-backed three-Infamy site benefit” |
| Konk: +1 to hit fighters | Normal battle resolution adds the modifier only against fighter unit types and records it in the attack | Fight result/log exposes the modifier; no manual control is needed | `index.test.ts`: “Konk applies its source-backed fighter attack modifier” |
| Toxicor: draw two Mutation cards and keep one | Mutation-site resolution draws two and persists a typed `mutation-choice`; selection adds the chosen card and returns the other to the live deck | Mutation-site Phase Actions present both cards as labeled buttons; the in-flight cruise-missile mutation remains an automatic combat timing boundary | `index.test.ts`: “Toxicor draws two Mutation cards and returns the unchosen card to the deck” |
| Disappear instead of Move (movement ability) | `disappear-monster` validates lair, Hollywood, movement ledger, return timing, and encounter suppression | Move context exposes “Disappear to lair” only when legal and confirms the irreversible action | `index.test.ts`: disappearance/return cycle and Hollywood rejection fixtures |

## Military records and units

| Ability | Backend implementation | User-facing affordance | Evidence |
|---|---|---|---|
| Army Missile Launcher: extra first-round attack before the monster | Combat resolver inserts the attack before monster attacks and records the modifier | Fight result/log identifies the opening attack; no manual button is needed | `index.test.ts`: “Army Missile Launcher makes its source-backed pre-monster first-round attack” |
| Navy Nuclear Submarine: launch as cruise missile | Move and Fight commands transform the unit to the missile profile, validate ownership/range/timing, and queue the battle | Selected-piece tray and Fight controls expose “Launch as cruise missile”; board highlights legal targets | `index.test.ts`: submarine range/ownership/movement fixtures |
| Air Force Cruise Missile: one round, +3 damage, mutate on attack roll 1 | Combat resolver applies missile stats, draws Mutation on roll 1 before later attacks, then destroys the missile after round one | Unit tray shows the one-round/missile rules; fight result shows mutation and destruction | `index.test.ts`: cruise-missile lifecycle, roll-one mutation, later-attack, and damage fixtures |
| National Guard: only Guard Commander holder may move/redeploy/control movement | Selectors and command validation apply Guard Commander permission; neutral Guard remains neutral for combat attribution | Guard Commander is shown as active in the military reference/card surface; only legal Guard units become selectable | `index.test.ts`: Guard movement, deployment, redeployment, allowance, and control fixtures |
| Giant units: record statistics and Challenge participation | Typed giant definitions, placement, Health damage, permanent removal, and giant-last Challenge sequence are authoritative | Research/placement controls and Challenge opponent controls expose the relevant decisions | `index.test.ts`: giant placement, damage/removal, ordering, and victory fixtures |
| Ordinary fighters/tanks/rocket launchers | Their movement, stats, occupancy, and attack behavior are authoritative record data; they have no additional printed special action | Selected-piece tray shows stats and any special text; movement/fight controls are context-specific | Catalogue tests and movement/combat matrix fixtures |

## Audit conclusion

There are no unimplemented printed monster or military-unit abilities in the
current development/provisional ruleset. Toxicor's Mutation-site choice is
fully player-controlled. Its in-flight cruise-missile trigger remains an
automatic combat timing boundary so a single attack roll does not create a
hidden mid-resolution pause; the draw is still recorded in the authoritative
combat result.

This audit does not promote unresolved physical-board topology, source-gated
lair/placement data, or broader card lifecycle rules. Those remain explicit
release boundaries rather than silently treated as complete.
