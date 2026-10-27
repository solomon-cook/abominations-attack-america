# Component exception register

This register inventories the component-specific rules that override or qualify
the general rulebook. It is an index into the typed component records and their
focused regressions; it does not resolve the separate open card-interaction
or board-review gates.

The rulebook's precedence statement is explicit: follow a monster, unit, or
special-card rule when it conflicts with a general rule. The photographed
component catalogue contains all six monster records, five military records,
both giant records, and all 32 cards. The tables below record the discovered
exceptions that change ordinary movement, combat order, control, encounter,
deployment, or lifecycle behavior.

## Monster records

| Component exception | Timing and target | Source | Engine regression |
| --- | --- | --- | --- |
| Zorb may take 2 Infamy instead of city Health. | City stomp, after the Health roll if one is required; active monster and its reward. | [`zorb-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/zorb-record-and-piece.jpg) | `Zorb rolls the city Health benefit before choosing Health or Infamy` |
| Tomanagi gains one attack in the first combat round at sea or seacoast. | First battle round; Tomanagi's attacks in a sea/coast space. | [`tomanagi-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/tomanagi-record-and-piece.jpg) | `Tomanagi gets one extra first-round attack in sea combat only` |
| Gargantis may discard Mutation cards for 3 Health each. | Any time; Gargantis and the cards in its controller's Mutation hand. | [`gargantis-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/gargantis-record-and-piece.jpg) | `Gargantis can discard one or more Mutation cards for three Health each` |
| Megaclaw gets 3 Infamy instead of 2 at an Infamy site. | Infamy-site stomp; Megaclaw's Infamy reward. | [`megaclaw-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/megaclaw-record-and-piece.jpg) | `Megaclaw receives its source-backed three-Infamy site benefit` |
| Konk gets +1 to hit Fighters. | Each attack by Konk against a Fighter. | [`konk-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/konk-record-and-piece.jpg) | `Konk applies its source-backed fighter attack modifier` |
| Toxicor draws two Mutation cards and chooses one when it mutates. | Each Toxicor mutation trigger; Toxicor's owner chooses one and the other returns to the deck. | [`toxicor-record-and-piece.jpg`](../references/monsters-menace-america/components/monster-records/toxicor-record-and-piece.jpg) | `Toxicor draws two Mutation cards and returns the unchosen card to the deck` |

All six exact ability texts are typed in [`monsters.ts`](../packages/game-engine/src/monsters.ts); the implementation and player-action audit is in [`monster-military-ability-audit.md`](monster-military-ability-audit.md).

## Military records and control

| Component exception | Timing and target | Source | Engine regression |
| --- | --- | --- | --- |
| Army Missile Launcher attacks before the monster in the first combat round. | First round of a battle involving the launcher; the defending monster is the target. | [`army-navy.jpg`](../references/monsters-menace-america/components/military-records/army-navy.jpg) | `Army Missile Launcher makes its source-backed pre-monster first-round attack` |
| A Nuclear Submarine can launch as a Cruise Missile with its starred movement and combat profile. | Declared for an eligible monster battle; the launch has the printed range, one-round lifetime, and roll-one mutation trigger. | [`army-navy.jpg`](../references/monsters-menace-america/components/military-records/army-navy.jpg), [rulebook page 10](../tmp/pdfs/rulebook-pages/page-10.jpg) | `submarine missile targets enforce range, ownership and movement, and queue combat`; missile lifecycle tests in `index.test.ts` |
| Air Force Cruise Missiles are destroyed after round one and mutate a monster on an attack roll of 1. | Each Cruise Missile attack; the defending monster and subsequent attacks in the same battle. | [`marines-air-force.jpg`](../references/monsters-menace-america/components/military-records/marines-air-force.jpg) | `Air Force Cruise Missile roll of one draws a face-up mutation card before later attacks`; `Air Force Cruise Missile is source-backed one-round hardware` |
| Guard Commander grants the only movement and redeployment control over neutral National Guard units. | While the card is held; movement, deployment, and redeployment by its controller. | [`giant-units-national-guard.jpg`](../references/monsters-menace-america/components/military-records/giant-units-national-guard.jpg), [`military-research-01.jpg`](../references/monsters-menace-america/components/decks/military-research-01.jpg) | `docs/national-guard-control-audit.md` and the Guard Commander engine regressions |
| Giant military units share spaces, do not consume ordinary Deploy slots, may use stomped owned bases through their card placement instruction, cannot be redeployed, and have special Challenge ordering and victory rules. | Placement, damage/removal, and Monster Challenge; the two giants and their controller. | [`giant-units-national-guard.jpg`](../references/monsters-menace-america/components/military-records/giant-units-national-guard.jpg), [`giant-placement-audit.md`](giant-placement-audit.md) | `giant Research cards place a sourced giant on the active branch base without consuming Deploy`; stomped-base placement, giant damage, and Challenge regressions |

The printed baseline and effective Guard movement values remain separate in
[`units.ts`](../packages/game-engine/src/units.ts). The giant cards may place on
any owned branch base, including a stomped base, under the sourced distinction
between card placement and ordinary deployment in `giant-placement-audit.md`.
Rulebook pages 7 and 14 establish that placement at a monster-occupied base
does not itself start a battle; the engine and regression follow that timing.

## Card exceptions

All 16 Mutation and 16 Military Research card texts, sources, classifications,
timing, and duration are recorded in the
[component catalogue](../references/monsters-menace-america/component-rules-catalogue.md)
and typed in [`cards.ts`](../packages/game-engine/src/cards.ts). Focused engine
coverage exercises each implemented card effect. The exception and interaction
examples with cross-card regressions are indexed in
[`effect-precedence.md`](effect-precedence.md); the card catalogue report and
`card-catalogue:verify` check source transcription and implementation status.

The register covers the complete card inventory:

- Mutation: `Fins and Gills`, `Rampage`, `Radiation Field`, `Atomic Recovery`,
  `Berserk`, `War Spikes`, `Atomic Breath`, `Iron Stomach`, `Whip Tentacles`,
  `High-Octane Blood`, `Son of a Monster`, `Winged Horror`, `Kinda Friendly`,
  `Laser Beam Eyes`, `Armored Scales`, and `It's a Robot!`.
- Military Research: `Mecha-Monster`, `Cutbacks`, `Laser Fence`, `Guard
  Commander`, `Defense Satellites`, `Stabilizer Ray`, `Fusion Cells`,
  `X-Fighters`, `Molecular Cannon`, `2nd Generation`, `Blonde Lure`,
  `Anti-Mutagen`, `Antimatter`, `Scientific Analysis`, `Chopper Lift`, and
  `Captain Colossal`.

The following non-generic boundaries are explicitly represented and tested:

- `Fins and Gills` crosses water barriers; `Winged Horror` grants flight and
  `+1 Move`; `Rampage` permits movement on the turn a monster emerges.
- `Kinda Friendly` passes through and returns National Guard without battle;
  `Laser Beam Eyes` specifically modifies attacks against Cruise Missiles.
- `High-Octane Blood` changes Monster Challenge attack order; `It's a Robot!`
  retaliates after a Challenge miss.
- `Defense Satellites` excludes both giant units; `X-Fighters` replace a
  branch deployment but cannot replace a Guard deployment.
- `Laser Fence`, `Molecular Cannon`, `Blonde Lure`, and `Chopper Lift` each have
  printed timing or movement restrictions that differ from ordinary movement
  and battle resolution.
- `Cutbacks` removes a face-up Research card from play and ends its persistent
  effect; its text does not grant permission to remove Mutation cards.

The remaining 11 card conflict/stacking policies stay source-gated under
`CARD-EFFECTS`. Their unresolved boundaries are listed card by card in
[`open-rules-decisions-for-owner.md`](open-rules-decisions-for-owner.md).

## Resolution boundary

The complete photographed component inventory has been reviewed against the
general-rule precedence statement. Every discovered monster, military-record,
National Guard, giant, and card exception is either represented in the typed
source catalogue and linked implementation audit or retained under the separate
`CARD-EFFECTS` gate. Reopen this register if a newly
reviewed component or rulebook source identifies an exception not listed here.
