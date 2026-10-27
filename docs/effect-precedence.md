# Implemented effect precedence

This is the precedence contract for the `prototype-0.1` development ruleset. It
only describes effects whose source text and implementation status are already
marked `implemented`; it is not a generic ruling for source-gated card stacking
policies or unresolved physical-board interactions.

## Resolution order

| Order | Layer | Current implementation boundary |
| ---: | --- | --- |
| 1 | Source-backed record values | The unit or monster record supplies the base Move, movement mode, Defense, Damage, Attacks, Health, and inventory identity. |
| 2 | Continuous persistent effects | Active Mutation and Research projections modify the base record before selectors or combat calculations run. Additive modifiers stack; an explicitly replacement-valued ability replaces that field. |
| 3 | Battle/turn window effects | Sourced start-of-battle, start-of-turn, and Deploy-window effects resolve before the ordinary action in that window. Armed one-shot effects are removed from the hand when accepted. |
| 4 | Roll and event triggers | Effects triggered by a specific roll, hit, miss, damage result, or movement outcome resolve immediately after that authoritative event and before the next event in the sequence. |
| 5 | Lifecycle and terminal accounting | Destroyed pieces, discarded cards, trophies, Hollywood results, pending decisions, and terminal winners are recorded after the authoritative resolution and before the event is emitted. |

## Implemented examples

- `High-Octane Blood` and `Winged Horror` each add `+1 Move`; `Armored Scales`
  applies `-1 Move` and `+1 Defense`; `Winged Horror` replaces the movement
  mode with Fly; `Fins and Gills` adds its conditional water-barrier Defense.
  High-Octane Blood and Armored Scales' opposing Move modifiers offset, while
  the independent Defense bonus remains active; the interaction registry and
  authoritative path test record this combination.
- `War Spikes` replaces the monster's ordinary hit damage with 4, while the
  record value remains the base input. `Fusion Cells` adds 1 Move to an owned
  military unit. `2nd Generation` adds one Deploy allowance and `Guard
  Commander` supplies the explicit National Guard control permission.
- `Scientific Analysis` and `Anti-Mutagen` resolve at battle start before normal
  combat rolls. `Antimatter` arms the first-round damage rule at that same
  boundary. When an opposing monster holds `Radiation Field`, a military natural-one
  attack is destroyed after its attack resolves. Against Defense 1, the natural
  one still hits, so Antimatter doubles its damage and rolls for mutation before
  the attacker is destroyed; against higher Defense it misses and deals no
  Antimatter damage.
  `Stabilizer Ray` is discarded when armed; after qualifying military damage,
  its holder chooses a Mutation that was available at that damage event.
- `Radiation Field`, `Whip Tentacles`, cruise-missile mutation, and Challenge
  retaliation resolve from the recorded roll/event before the next attack. In a
  battle holding both Radiation Field and Whip Tentacles, the card regression
  confirms that an opposing unit's natural one and the monster's natural six
  can each resolve their distinct trigger. If the natural one also damages the
  monster, Stabilizer Ray opens its Mutation-discard choice while Radiation
  Field destroys the attacker; the combined regression covers both effects.
- `Anti-Mutagen` and `Scientific Analysis` each remove Health at the start of a
  battle involving the cardholder's units. When both are held by that
  cardholder, both losses resolve before ordinary attacks, as their separate
  card texts direct.
- `Berserk` and `Son of a Monster` each add their printed attacks to the same
  battle when used in that battle; `Son of a Monster` also resolves its Health
  roll. Both cards are discarded after use.
- `Atomic Breath` adds an attack in round one, and `Whip Tentacles` adds another
  immediately for each natural six. The first-round allowance and the roll
  trigger both apply when the cards are held together. When `Berserk` is used
  before round one resolves, its five battle attacks also add to Atomic Breath's
  first-round attack grant; Atomic Breath does not grant another attack in round
  two.
- `Fins and Gills` adds its conditional Defense point in a water-barrier space;
  `Armored Scales` adds its independent Defense point in every space. Both
  bonuses apply together at a water barrier, while only `Armored Scales`
  applies elsewhere.
- `Iron Stomach` resolves its Health-or-Infamy choice during a military-base
  Encounter. `Atomic Recovery` restores Health below starting Health at the
  beginning of its owner's next turn. Their distinct printed timing windows
  mean both effects apply in sequence; `CARD_INTERACTION_RULES` records this
  pair and the combined regression verifies the Health gain and later recovery.
- `2nd Generation` adds one deployment from the player's branch or National
  Guard. `X-Fighters` may replace a branch unit deployment, so either X-Fighter
  can use the added branch slot; the interaction registry and engine regression
  cover deploying both X-Fighters and a regular branch unit in the same Deploy
  step.
- `Fusion Cells` adds 1 Move to all of its holder's units. Owned X-Fighters are
  included: the combined regression draws and deploys an X-Fighter, then
  confirms the seven-step flight range while Fusion Cells remains face up.
- `Cutbacks` removes one public face-up Research card from play. The selected
  card leaves its owner's active Research cards, so its persistent effect no
  longer contributes to the next authoritative calculation; the source does
  not make this a general permission to remove Mutation cards.
- `Chopper Lift` movement opens the `Laser Fence` after-move reaction window
  under the literal card wording. This is a documented interpretation because
  neither card explicitly names the other; retreating an unrelated monster
  leaves the active monster's pending Encounter intact.
- `Blonde Lure` constrains the chosen monster's next turn, while `Chopper Lift`
  can move it earlier on another player's turn. That earlier lift neither
  satisfies nor consumes the lure; when the target's next Move begins, the
  chosen endpoint remains required if the target can reach it.
- `Blonde Lure` also remains pending if `Molecular Cannon` relocates the target
  to one of its lairs before its next turn. The next Move must still end at the
  chosen endpoint when it is reachable; the battle relocation does not satisfy
  the printed next-turn requirement.

The engine keeps source-gated placement, movement, stacking, visibility, and
permanent-lifecycle questions unavailable rather than applying this order to
them. The authoritative projections and timing regressions are covered by the
continuous-effect, battle-start, combat-trigger, card-lifecycle, and replay
tests in `packages/game-engine/src/index.test.ts`.

The shared effect boundary is represented by `EffectInstance` and
`composeEffectPlan` in `packages/game-engine/src/effects.ts`. The plan retains
available and blocked instances separately and groups stat, movement, attack,
control, placement, and triggered effects without resolving their rules. Any
caller that is ready to resolve a plan must call `assertEffectPlanAvailable`
first; source-gated instances therefore fail closed instead of receiving
generic target, stacking, or lifecycle behaviour.

Card conflict metadata is kept separately in `CARD_STACKING_RULES` in
`packages/game-engine/src/cards.ts`. The registry covers every inventoried
card, records the cited source, and only resolves additive, replacement, or
permission composition where the captured text and existing implementation
establish it. The remaining cards are explicitly `source-gated`; they do not
inherit a default stacking rule.
