# Implemented effect precedence

This is the precedence contract for the `prototype-0.1` development ruleset. It
only describes effects whose source text and implementation status are already
marked `implemented`; it is not a generic ruling for the three source-gated
Research cards or unresolved physical-board interactions.

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
- `War Spikes` replaces the monster's ordinary hit damage with 4, while the
  record value remains the base input. `Fusion Cells` adds 1 Move to an owned
  military unit. `2nd Generation` adds one Deploy allowance and `Guard
  Commander` supplies the explicit National Guard control permission.
- `Scientific Analysis` and `Anti-Mutagen` resolve at battle start before normal
  combat rolls. `Antimatter` arms the first-round damage rule at that same
  boundary. `Stabilizer Ray` is discarded when armed and its selected Mutation
  is discarded only after qualifying military damage.
- `Radiation Field`, `Whip Tentacles`, cruise-missile mutation, and Challenge
  retaliation resolve from the recorded roll/event before the next attack.

The engine keeps source-gated placement, movement, stacking, visibility, and
permanent-lifecycle questions unavailable rather than applying this order to
them. The authoritative projections and timing regressions are covered by the
continuous-effect, battle-start, combat-trigger, card-lifecycle, and replay
tests in `packages/game-engine/src/index.test.ts`.
