# Branch deployment source audit

Status: **source cross-check complete; rule and engine behavior verified**

This audit closes the branch-allowance and ordinary Deploy-rule source gap. It
does not approve National Guard control beyond Guard Commander, unit combat
exceptions, card interactions, or production release.

## Independent source comparison

The branch allowance is transcribed from the photographed military record tile
and cross-checked against the rulebook's Deploy example on page 14:

| Branch | Record-tile wording | Typed allowance |
| --- | --- | --- |
| Army | Place 2 Army or National Guard units, plus 1 National Guard unit if available, or draw 1 Military Research card. | 2 own-or-Guard + 1 additional Guard |
| Navy | Place 2 Navy or National Guard units, plus 1 National Guard unit if available, or draw 1 Military Research card. | 2 own-or-Guard + 1 additional Guard |
| Air Force | Place 2 Air Force or National Guard units, plus 1 National Guard unit if available, or draw 1 Military Research card. | 2 own-or-Guard + 1 additional Guard |
| Marines | Place 3 Marines or National Guard units, or draw 1 Military Research card. | 3 own-or-Guard |

Sources: [Army and Navy record tiles](../references/monsters-menace-america/components/military-records/army-navy.jpg), [Marines and Air Force record tiles](../references/monsters-menace-america/components/military-records/marines-air-force.jpg), and the original rulebook Deploy page at [`tmp/pdfs/rulebook-pages/page-14.jpg`](../tmp/pdfs/rulebook-pages/page-14.jpg). The transcribed rule text is in [the rules reference](monsters-menace-america-rules.md#4-deploy).

The same rulebook page establishes these Deploy constraints:

- At most one military unit from any branch enters a space in a turn.
- A player's branch units deploy only to unstomped bases belonging to that branch.
- National Guard units deploy to any unstomped city, base, or Infamy site.
- A legal space may already contain a monster.
- Redeploying one owned-branch unit to an unstomped base of that branch consumes one deployment from the allowance.
- National Guard and giant units cannot be redeployed under the ordinary rules.
- The player may draw one Military Research card instead of deploying units; the card is placed face up immediately.

## Implementation evidence

- `BRANCH_DEPLOYMENT_DEFINITIONS` records the four photographed formulas and is marked implemented in `packages/game-engine/src/units.ts`.
- The authoritative Deploy and setup commands use these allowances, validate unit inventory and destinations, reserve at most one new military unit per destination per turn, reject stomped bases, and implement the Research alternative.
- Engine coverage includes the source-backed catalogue values, starting deployment with the Army allowance and optional Guard slot, Research in place of deployment, a 2/3/4-player all-branch matrix, inventory exhaustion, collisions, stomped bases, redeployment, and explicit Deploy pass.
- The in-app deployment selector is checked by `npm run verify:military-deployment-ui`.

The unresolved Guard Commander lifecycle, printed/effective National Guard movement and control, unit-specific combat effects, card interactions, and full-rules source review remain separately gated.
