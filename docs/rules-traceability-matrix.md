# Rules traceability matrix

This matrix is the implementation boundary for the current web prototype. It maps every section of [the rules reference](monsters-menace-america-rules.md) to the code, interface, and tests that currently cover it. `Foundation` means the slice is implemented but simplified; `Partial` means only some behaviours are present; `Unresolved` means source or implementation work is still blocking a production claim.

## Source authority order

When sources disagree, record the conflict rather than silently choosing a value. The review order is:

1. Printed board and component evidence for physical placement, labels, statistics, inventories, and card text.
2. The consolidated rules reference for the rules interpretation and timing summary.
3. `docs/rules-source.md` for an explicitly documented digital adaptation.
4. Engine behaviour, then UI wording, only after the preceding source has been recorded.

The component catalogue is source-backed reference data, not a licence to ship third-party artwork or unverified rules text. Any unresolved rule-bearing fact remains unresolved in this matrix and in the rules reference's final inventory.

## Section coverage

| Rules section | Engine mapping | UI mapping | Test evidence | Status |
| --- | --- | --- | --- | --- |
| Source authority | `docs/rules-source.md`; no rule code | No source claims in UI | Review boundary only | Foundation |
| Confirmed digital interpretations | `docs/rules-source.md` | Local play, online room, spectator controls in `apps/web/src/main.tsx` | `apps/api/src/store.test.ts` | Partial |
| Game overview | `createGame`, `GameState`, `Phase` in `packages/game-engine/src/index.ts` | Round, active monster, phase, and log status cards | `packages/game-engine/src/index.test.ts` | Foundation |
| Setup | `createGame(playerCount)` | Room creation and join controls | `apps/api/src/store.test.ts` | Partial |
| Shared setup | `createGame` seeds a simplified state | No complete setup flow | No dedicated setup fixture | Partial |
| Choose monsters and military branches | `createGame` selects a bounded monster slice; branches are fixed | No assignment UI | No assignment tests | Partial |
| Starting positions | `createGame` places monsters and units | Map renders current positions | Legal move fixture only | Partial |
| Turn structure | `Phase`, `applyCommand`, phase transitions | Current-step card and advance button | Complete-turn test in `packages/game-engine/src/index.test.ts` | Foundation |
| 1. Move | `moveMonster`, location links, `GameCommand` | Location buttons are enabled during Move | Legal and illegal move tests | Partial |
| Monster movement | Destination-only link check | Map selection, not path preview | Illegal destination test | Partial |
| Disappearing instead of moving | Not implemented | Not exposed | None | Unresolved |
| Military-unit movement | Not implemented | Units are displayed only as board data | None | Unresolved |
| Movement abilities | Not implemented | None | None | Unresolved |
| 2. Fight | `resolveFight` gives a simplified two-round loop with uncontrolled dice | Fight action and log | Complete-turn coverage only; no deterministic combat fixture | Partial |
| Starting and ordering battles | Units at the monster location become targets | Fight prompt | No ordering fixture | Partial |
| Attack resolution | Simplified `Math.random()` hit check | Log shows hit/miss and roll | No outcome matrix | Partial |
| Monster attacks | One simplified monster attack per target iteration | No target selection | None | Unresolved |
| Military attacks | Not implemented | None | None | Unresolved |
| Attacks that cause mutations | Not implemented | None | None | Unresolved |
| Damage and destruction | Removes a unit on a hit; monster damage not resolved | Unit destruction appears in log | No damage fixture | Partial |
| Retreating after a normal battle | Not implemented | None | None | Unresolved |
| Hollywood | Not implemented | Hollywood is a decorative label only | None | Unresolved |
| 3. Encounter | `resolveEncounter` applies simplified city, infamy, and mutation effects | Encounter prompt and advance button | Complete-turn coverage only | Partial |
| Stomping | Decrements a shared marker counter on Encounter | Stomp marker status | No stomp legality/threshold fixture | Partial |
| City benefit | City encounter adds two health, capped at max | City marker labels are rendered | No benefit matrix | Partial |
| Military-base benefit | Base is represented as a location; reward absent | Base marker icon | None | Unresolved |
| Infamy-site benefit | Infamy location adds two infamy | Infamy site icon | None | Partial |
| Infamy | `Monster.infamy` exists and Infamy-site encounter increments it | Infamy is shown on the monster record | No spending or threshold fixture | Partial |
| Mutation sites | Mutation location adds one health; card effect absent | Mutation site icon | None | Partial |
| Challenge sites | Challenge location exists; challenge absent | Challenge icon | None | Unresolved |
| Other spaces | Only the simplified location kinds exist | Decorative grid and labels | None | Unresolved |
| 4. Deploy | `deployUnit` adds one simplified unit and passes turn | Deploy & pass turn button | Complete-turn fixture | Partial |
| Normal deployment | Simplified deployment to the first base | Deploy action | None | Partial |
| Redeploying | Not implemented | None | None | Unresolved |
| Military Research instead of deployment | Not implemented | None | None | Unresolved |
| Mutation and Research card decks | Catalogue records exist; engine decks do not | None | Catalogue verification script | Unresolved |
| Giant military units | Catalogue records exist; match state does not | Military art assets are present but not gameplay-linked | Catalogue verification script | Unresolved |
| The Monster Challenge | Not implemented | Challenge location is only a destination marker | None | Unresolved |
| Declaring and timing the Challenge | Not implemented | None | None | Unresolved |
| Challenge sequence | Not implemented | None | None | Unresolved |
| Winning | No winner state or rule resolution | No winner screen | None | Unresolved |
| Engine invariants and required state | Basic `GameState` and phase guard in `packages/game-engine/src/index.ts` | API carries room state | Engine and store smoke tests | Foundation |
| Deliberately unresolved implementation inputs | Listed in `docs/monsters-menace-america-rules.md` | No invented values presented as complete rules | Catalogue uncertainty validation | Foundation |

## Gaps that block the next release gate

The matrix intentionally exposes the current gaps instead of treating typecheck, build, or a playable-looking board as rules proof. The P0 blockers are canonical authored hex data, deterministic commands and randomness, complete setup, path-based movement, deterministic battles, encounters, and the Monster Challenge. The existing nine-location graph remains a named development fixture until the canonical board work is sourced and validated.

## Review checklist

- [ ] A reviewer has signed off each rule-bearing source datum.
- [ ] Every `Unresolved` row has either a source-backed implementation task or an explicit release block.
- [ ] New engine rules add or update the corresponding UI and test evidence in the same change.
