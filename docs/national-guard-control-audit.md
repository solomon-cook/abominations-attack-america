# National Guard control source audit

This audit closes the Guard Commander control lifecycle using the photographed
record and Research card, together with the general rules reference. It covers
Guard control and placement only; regular-unit effects remain in the separate
`UNIT-STATS` gate.

## Source-backed lifecycle

The [National Guard record photo](../references/monsters-menace-america/components/military-records/giant-units-national-guard.jpg)
records six tanks and two fighters, Move 0, and the restriction that only the
player with Guard Commander may move them. The [Military Research photo](../references/monsters-menace-america/components/decks/military-research-01.jpg)
shows the card grants movement and redeployment, sets Tank Move 3 (land only)
and Fighter Move 5 (fly), and prevents other players from deploying Guard.

The general rules reference states that Guard is neutral by default, any
player may deploy it within their branch allowance when no player holds Guard
Commander, and deployment alone gives no movement or redeployment control.
With Guard Commander, its holder alone deploys Guard; redeployment goes to an
unstomped base of that player's branch and consumes the usual own-or-Guard
allowance, including any applicable additional Guard and 2nd Generation slots.
Any number of units may share a space. The stomp rules remove a unit from the
stomped base's own branch as a trophy and prohibit later deployment on that
space; they do not remove a National Guard unit from another branch's base.
See [the movement, stomp, deployment, and redeployment rules](monsters-menace-america-rules.md).

Guard Commander is a continuous, face-up effect until removed from play. The
same Research photo shows Cutbacks removes a Research card from play. The
engine's Cutbacks path removes Guard Commander from its holder, leaves already
deployed Guard pieces in place, and restores neutral control because no player
then holds the control card. A focused regression covers this transition.

## Implementation evidence

- `NATIONAL_GUARD_DEFINITIONS` links both the photographed record and
  Guard Commander card and marks control as implemented.
- The engine enforces neutral deployment, cardholder-only deployment,
  movement, Guard redeployment, the source-backed movement profiles, and the
  branch deployment allowance.
- Engine tests cover those paths and card removal. Guard remains a neutral
  inventory: a player's temporary control never changes a Guard unit's owner.

The unimplemented regular-unit movement/combat abilities, other card
interactions, and full production rules remain separately gated.
