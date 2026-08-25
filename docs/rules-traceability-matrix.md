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
| 1. Move | `moveMonster`, immutable `DEVELOPMENT_BOARD` edges, `GameCommand.path` (development fixture) | Engine-provided path preview and canonical hex-key commands | Complete-path, occupancy-stop, ledger, and illegal-path tests | Partial |
| Monster movement | Complete path validation over explicit board edges, with development occupancy stops; full source-gated abilities remain unresolved | Map selection and complete path preview | Authoritative path and occupancy tests | Partial |
| Disappearing instead of moving | `disappear-monster` removes the active monster for the current turn, rejects Hollywood, and consumes Move when a completed setup supplies its lair; production lairs remain source-gated | Move controls expose disappearance when the active setup assignment has a verified lair | Disappearance/return cycle and Hollywood rejection fixtures in `packages/game-engine/src/index.test.ts` | Partial |
| Military-unit movement | Development branch units use complete canonical-hex paths, shared military occupancy, movement-specific water/barrier gates, and a per-turn ledger; neutral National Guard IDs are rejected by ordinary movement; source-gated unit data remains unresolved | Selectable units, path preview, confirm/cancel, and explicit battle creation | Military movement, National Guard prohibition, ledger, water/barrier, and pending-battle tests | Partial |
| Movement abilities | Not implemented | None | None | Unresolved |
| 2. Fight | `resolveFight` gives a deterministic two-round development loop and records combat round count, rolls, smash flags, and attack details; source-specific control and target rules remain unresolved | Fight action and log | Seeded combat replay and multi-battle queue fixtures | Partial |
| Starting and ordering battles | Move queues every development collision as a compulsory `PendingBattle`; `resolve-fight.battleId` lets the active player choose queue order | Fight prompt lists each queued battle and exposes explicit resolution-order buttons | Multi-battle ordering fixture | Partial |
| Attack resolution | Seeded die rolls, Defense threshold, natural-six smash flag, one-at-a-time target re-evaluation, explicit first-target ordering, and per-attack detail in the development fixture | Log shows hit/miss, roll, smash, and round; multi-unit battles expose the first target choice | Deterministic miss/hit/smash/sequencing and combat replay fixtures | Partial |
| Monster attacks | Development fixture resolves surviving targets across exactly two combat rounds; a multi-unit battle now persists an explicit first target choice, while printed attack count and later attack-by-attack decisions remain source-gated | First-target choice buttons appear for multi-unit battles; later attacks are still sequenced by the development resolver | Two-round replay and persisted first-target fixture | Partial |
| Military attacks | Development units, including neutral Guard units present in battle state, carry source-backed record stats; normal battle validation rejects non-military target references and Guard attack events attribute control to the active player, while Konk applies its typed +1-to-hit-fighters modifier, Army Missile Launcher gets its first-round pre-monster attack, and Air Force Cruise Missiles are destroyed after round one and draw a face-up Mutation card on roll one; card effects, Challenge target legality, and other special attacks remain unresolved | No dedicated target-choice UI | Deterministic combat replay, target-class validation, Guard-controller, Konk modifier, missile-launcher, cruise-missile lifecycle, and mutation-draw fixtures cover the development boundary | Partial |
| Attacks that cause mutations | Not implemented | None | None | Unresolved |
| Damage and destruction | Development normal-unit destruction returns the unit to `record-tile` and preserves inventory; permanent removal is tracked separately; monster damage remains development-only | Unit return and attack details appear in the log | Deterministic combat replay and inventory-preservation assertions | Partial |
| Retreating after a normal battle | Development normal battles create a typed retreat decision with board-adjacent legal options; explicit retreat suppresses Encounter, supports forced disappearance when no option exists, and awards one Research card when the active player's units forced the retreat; production water, entry-space, ownership, and Hollywood exceptions remain unresolved | Retreat choice panel lists each surviving unit and legal destination; the updated Research hand is visible after resolution | Retreat decision, Research reward, and Encounter-suppression fixtures | Partial |
| Hollywood | Defeated pre-Challenge monsters move to Hollywood and discard Infamy; a rival military controller receives one Research card; start-of-turn deterministic recovery rolls keep them there below 5 Health or release them to Los Angeles/assigned lair while consuming Move; disappearance remains prohibited | Hollywood state, automatic roll, and rival Research reward are surfaced through the authoritative event/log and card surface | Hollywood entry, recovery, release, rival reward, and disappearance-rejection fixtures in `packages/game-engine/src/index.test.ts` | Partial |
| 3. Encounter | `resolveEncounter` applies simplified city, infamy, and mutation effects | Encounter prompt and advance button | Complete-turn coverage only | Partial |
| Stomping | Decrements a shared marker counter on Encounter | Stomp marker status | No stomp legality/threshold fixture | Partial |
| City benefit | Development markers are structured as fixed 1/2 Health or seeded 1/2/3-dice `CityBenefit` values with a 40-Health cap; Zorb's Health-versus-2-Infamy choice is a typed pending decision; physical-board benefits remain unresolved | City marker labels and Zorb's choice buttons are rendered; encounter effects are logged | Fixed/dice/cap and Zorb-choice fixtures | Partial |
| Military-base benefit | Base Encounter grants one Infamy, pauses for the owning branch's legal board/record-tile trophy choice, permanently removes the selected unit, and skips the choice when that branch inventory is exhausted; physical board bases remain source-gated | Base marker and owner-only trophy choice controls | Base reward, legal-choice, permanent-removal, and exhausted-inventory fixtures | Partial |
| Infamy-site benefit | Infamy location adds two infamy, or three for source-backed Megaclaw | Infamy site icon | Capped standard and Megaclaw exception fixtures | Partial |
| Infamy | `Monster.infamy` exists, Infamy-site encounter increments it, and an explicit `resolve-fight.spendInfamy` command grants one extra first-round attack per spent token before rolling | Infamy is shown on the monster record | Infamy spend, cap, and combat event fixtures; full source exceptions remain gated | Partial |
| Mutation sites | Per-monster/per-site use is tracked and first use draws a face-up Mutation card into the monster player's authoritative hand; card effects remain explicitly source-gated and no invented Health reward is applied | Mutation site icon and encounter log | One-use, deterministic draw, and no-invented-reward fixtures | Partial |
| Challenge sites | Challenge sites are inert before declaration; post-declaration challenger replacement and duel sequencing remain unimplemented | Challenge icon is shown as a destination marker | Pre-declaration no-op fixture; full Challenge fixtures remain absent | Partial |
| Other spaces | Non-stompable/blank spaces now skip Encounter without consuming a marker; physical lairs and the complete board remain source-gated | Decorative grid and labels | Blank-space no-op fixture; canonical board coverage remains unresolved | Partial |
| 4. Deploy | `deployUnit` adds one simplified unit and passes turn | Deploy & pass turn button | Complete-turn fixture | Partial |
| Normal deployment | Typed branch units deploy only to the active branch's verified, unstomped base; neutral National Guard records deploy within their source-backed city/base/Infamy destination classes only for a player holding the source-backed Guard Commander card; movement/deployment overrides are otherwise rejected and redeployment remains source-gated | Deploy action | Deployment, Guard-destination, Guard Commander permission, collision, neutral-control, inventory, and stomped-base fixtures | Partial |
| Redeploying | Not implemented | None | None | Unresolved |
| Military Research instead of deployment | Deploy-phase `draw-research` draws the next deterministic Research card into the active player's hand and ends Deploy; card effects remain source-gated | Draw Research action | Deterministic draw, exhaustion, ownership, and projection fixtures | Partial |
| Mutation and Research card decks | Deterministically shuffled engine decks support draw, discard, and exhaustion state; card effects, timing, visibility, and permanent lifecycle remain source-gated | No card timing UI | Card lifecycle and projection tests | Partial |
| Giant military units | Catalogue records exist; match state does not | Military art assets are present but not gameplay-linked | Catalogue verification script | Unresolved |
| The Monster Challenge | Not implemented | Challenge location is only a destination marker | None | Unresolved |
| Declaring and timing the Challenge | Not implemented | None | None | Unresolved |
| Challenge sequence | Not implemented | None | None | Unresolved |
| Winning | No winner state or rule resolution | No winner screen | None | Unresolved |
| Engine invariants and required state | `GameState.pendingDecision` plus typed command/phase guards, source-counted regular-unit and exact National Guard inventory validation before and after event transitions, and explicit six-tank/two-fighter National Guard record inventory in `packages/game-engine/src/index.ts`; Guard control/placement and giant quantities remain source-gated | API carries the authoritative decision and structurally validated room state | Pending-decision, regular/Guard inventory drift, post-command conservation, source-quantity, migration, and store command tests | Partial |
| Deliberately unresolved implementation inputs | Listed in `docs/monsters-menace-america-rules.md` | No invented values presented as complete rules | Catalogue uncertainty validation | Foundation |

## Gaps that block the next release gate

The matrix intentionally exposes the current gaps instead of treating typecheck, build, or a playable-looking board as rules proof. A 254-hex coordinate shell now records the photographed honeycomb extent, and `docs/full-honeycomb-board-evidence.md` records the source and promotion checklist, but the fully filled authoritative honeycomb board remains a P0 blocker until every printed feature, water class, label, barrier, and edge is sourced and reviewed. The other P0 blockers are deterministic commands and randomness, complete setup, path-based movement, deterministic battles, encounters, and the Monster Challenge. The existing nine-location graph remains a named development fixture and cannot satisfy the first-playable MVP gate.

## Review checklist

- [ ] A reviewer has signed off each rule-bearing source datum.
- [ ] Every `Unresolved` row has either a source-backed implementation task or an explicit release block.
- [ ] New engine rules add or update the corresponding UI and test evidence in the same change.
