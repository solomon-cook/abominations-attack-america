# Special Rules User-Visible Audit Checklist

Audit date: 2026-09-20

Each item was checked against four points: the engine trigger, the resulting
state/event, the user-facing control or automatic result presentation, and a
regression fixture. A checked item is verified for the current development and
provisional rulesets.

## Monster records and movement

- [x] Zorb — city Health versus 2 Infamy choice: `resolveEncounterResult`, `PhaseActions`, `EncounterOverlay`, and the Zorb fixture.
- [x] Tomanagi — extra first-round sea/coast attack: `effectiveMonsterAttacks`, fight result presentation, and the sea-combat fixture.
- [x] Gargantis — discard Mutation cards for Health: `use-monster-ability`, held-card action, and Gargantis fixture.
- [x] Megaclaw — three Infamy at an Infamy site: encounter resolver/result panel and Megaclaw fixture.
- [x] Konk — +1 to hit fighters: attack modifier/event detail and Konk fixture.
- [x] Toxicor — two Mutation cards at a Mutation site: persisted `mutation-choice`, labeled “Keep …” buttons, projection redaction, and Toxicor fixture.
- [x] Toxicor — in-flight cruise-missile mutation: automatic combat timing, mutation draw/event detail, and cruise-missile fixtures. This remains automatic because pausing inside an already-running attack sequence would create a hidden intermediate combat state.
- [x] Disappear instead of Move: legal Move-context button, confirmation, return-to-lair state, and disappearance fixtures.

## Military units and record abilities

- [x] Army Missile Launcher — extra first-round attack before monster: combat ordering, attack modifier, result surface, and fixture.
- [x] Nuclear Submarine — launch as cruise missile: selected-piece/Fight controls, range validation, transformed state, and submarine fixtures.
- [x] Air Force Cruise Missile — one-round life, three damage, roll-one Mutation: selected-unit rules, combat log/result, and lifecycle fixtures.
- [x] National Guard / Guard Commander — control, movement, deployment, and redeployment: legal selectors, card status, command validation, and Guard fixtures.
- [x] Mecha-Monster — placement, Health, permanent removal, Challenge: Research/Challenge controls and giant fixtures.
- [x] Captain Colossal — placement, Health, permanent removal, Challenge: Research/Challenge controls and giant fixtures.
- [x] Ordinary tanks, fighters, rocket launchers — record movement/stats and attack behavior: selected-piece tray, movement/fight controls, catalogue and matrix fixtures.

## Mutation cards

- [x] Fins and Gills — water barriers and conditional Defense: movement/defense projection and held-card rule text.
- [x] Rampage — move after emerging from a lair: turn transition, movement selector, and Rampage fixture.
- [x] Radiation Field — destroy military attacker on attack roll 1: combat result modifier/log and fixture.
- [x] Atomic Recovery — restore starting Health at turn start: turn transition, Health display, and fixture.
- [x] Berserk — five extra battle attacks: held-card/Fight action and fixture.
- [x] War Spikes — four damage per hit: combat damage/result and fixture.
- [x] Atomic Breath — extra first-round attack: combat result and fixture.
- [x] Iron Stomach — base Health instead of Infamy: encounter choice controls and fixture.
- [x] Whip Tentacles — extra attack after a six: combat attack sequence/result and fixture.
- [x] High-Octane Blood — +1 Move and Challenge-first order: selectors, Challenge controls, and fixtures.
- [x] Son of a Monster — two attacks plus Health die: held-card/Fight action and fixture.
- [x] Winged Horror — +1 Move and Fly: movement selectors and fixture.
- [x] Kinda Friendly — pass/return National Guard without fighting: movement resolution, board state/log, and fixture.
- [x] Laser Beam Eyes — +2 against cruise missiles: attack modifier/result and fixture.
- [x] Armored Scales — +1 Defense and -1 Move: continuous effect projection, selected stats, and fixture.
- [x] It’s a Robot! — electrocution after a Challenge miss: Challenge result and fixture.

## Military Research cards

- [x] Defense Satellites — roll damage for each board monster: phase/hand controls, result panel, and fixture.
- [x] Antimatter — double first-round military damage and mutation rolls: battle-start controls, combat result, and fixture.
- [x] Stabilizer Ray — choose Mutation to discard after damage: target selector, delayed discard, and fixture.
- [x] Laser Fence — pay Infamy or retreat: explicit outcome/destination controls and fixture.
- [x] Guard Commander — persistent Guard permission: Military Sheet status plus legal selectors and Guard fixtures.
- [x] Fusion Cells — +1 Move for units: movement highlighting/validation and fixture.
- [x] Mecha-Monster — deploy giant: Research card placement controls and fixture.
- [x] Cutbacks — remove a Research card from play: held-card target selector, `removedResearchCardIds`, and fixture.
- [x] X-Fighters — create/deploy two special fighters: Military Sheet deployment controls and lifecycle fixtures.
- [x] Molecular Cannon — roll damage and move monster to assigned lair: held-card target control, normalized lair coordinate, result/log, and fixture.
- [x] 2nd Generation — extra deployment: deployment allowance/UI and fixture.
- [x] Blonde Lure — choose monster and adjacent destination: dedicated board-adjacent controls and fixture.
- [x] Anti-Mutagen — battle-start damage per Mutation: automatic battle result/log and fixture.
- [x] Scientific Analysis — battle-start damage: automatic battle result/log and fixture.
- [x] Chopper Lift — roll movement, legal destination, terrain/site/occupancy limits, and Infamy loss: held-card target selector, authoritative validation, result/log, and fixture.
- [x] Captain Colossal — deploy giant: Research card placement controls and fixture.

## Accessibility and presentation checks

- [x] Every manual choice has a native button or select element with descriptive visible text.
- [x] Toxicor’s choice is announced by the phase label, action dock, attention banner, and labeled buttons.
- [x] Automatic effects are shown through the authoritative event log/result panels and card rule text.
- [x] Other players’ Mutation choice card IDs are redacted from projected state.
- [x] Card rules remain readable from the accessible record/hand surfaces even when no action is currently legal.
