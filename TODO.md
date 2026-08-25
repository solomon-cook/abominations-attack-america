# Abominations Attack America — Web Playable Roadmap

This is the delivery checklist for turning the current browser prototype into a complete, understandable, and reliable web game. It is ordered by dependency: later milestones assume the earlier rules, data, and engine foundations are complete.

## Definition of playable

A web version is playable when 2–4 players can create or join a match, complete setup, take every Move/Fight/Encounter/Deploy decision, use the major board and card systems, trigger and finish the Monster Challenge, determine the correct winner, reconnect after interruption, and understand legal actions and outcomes through the interface without consulting developer tools.

The first-playable checkpoint arrives earlier: two players can finish a coherent simplified match from setup to victory on the authoritative board. It is a learning milestone, not the full-rules release.

## How to use this roadmap

- `[P0]` blocks the first playable or protects rules/data correctness.
- `[P1]` is required for the complete public web release.
- `[Later]` is intentionally outside v1.
- Check an item only when its stated behaviour is implemented and verified at the appropriate proof level.
- A build or typecheck does not prove board accuracy, browser usability, online reliability, or rules fidelity.
- Preserve unknown component facts as unresolved research tasks. Do not invent board geometry, statistics, inventories, or card effects.

Useful source documents:

- [Rules source and implementation boundary](docs/rules-source.md)
- [Rules reference](docs/monsters-menace-america-rules.md)
- [Component-rules catalogue](references/monsters-menace-america/component-rules-catalogue.md)
- [Backend hex-grid plan](docs/backend-hex-grid-plan.md)

## Current-state inventory

| Area | Status | Evidence and limitation |
| --- | --- | --- |
| Shared rules package | Foundation exists | `packages/game-engine` owns a basic four-step turn loop, but it is simplified and uses non-deterministic combat. |
| Browser client | Partial prototype | React/Vite renders a playable-looking board, local turns, room controls, phase prompts, and a log; the grid is decorative and topology is still a nine-location graph. |
| Online rooms | Foundation exists | The API supports create, join, act, read, WebSockets, and polling fallback; production-grade projections, replay, lifecycle, and reconnect handling remain incomplete. |
| Persistence | Foundation exists | In-memory and Prisma stores exist with room versions and events; durable idempotency and schema/version migration still need hardening. |
| Session restoration | Foundation exists | A browser session token is restored from local storage; expiry, revocation, stale revisions, and multi-tab behaviour remain unresolved. |
| Spectators | Foundation exists | No-login spectators can join and read a room; hidden-information projections and complete spectator UX are not yet proven. |
| Rules research | Strong reference base | A consolidated rules reference and component catalogue exist, but several board, record-tile, and card facts remain unresolved. |
| Board | Partial reconstruction | A 12×19 visual grid and several rule-space markers exist; it is not yet the canonical verified board used by the engine. |
| Military art | Foundation exists | Original/generated transparent military sprites and a manifest exist; completeness, consistency, attribution, and final licensing still require review. |
| Automated checks | Thin foundation | Engine and store tests, typechecks, builds, and catalogue verification exist; full rules, browser, persistence, and end-to-end coverage do not. |

---

## Milestone 1 — Rules and source-data audit

**Priority:** P0  
**Depends on:** nothing  
**Outcome:** every rule-affecting implementation input is either sourced and structured or explicitly blocked as unresolved.

- [x] [P0] Create a traceability matrix from every section of the rules reference to engine, UI, and test work. (`docs/rules-traceability-matrix.md`; verified by `npm run traceability:verify`)
  - [x] [P0] Record the source-authority order for rulebook text, board printing, record tiles, cards, and project-specific digital interpretations.
- [ ] [P0] Inventory every monster, military branch, National Guard unit, giant unit, marker, token, die, and deck required for 2–4 players.
  - [P0] Transcribe each monster's starting Health, Move, Defense, Damage, Attacks, lairs, and special ability with source references.
- [ ] [P0] Transcribe every military unit's quantity, Move, Defense, Damage, Attacks, movement abilities, and special rules.
  - [P0] Transcribe each branch's unit inventory and deployment allowance/formula from its record tile.
- [ ] [P0] Transcribe National Guard statistics and all general placement/control restrictions.
  - [P0] Transcribe Captain Colossal and Mecha-Monster statistics, placement rules, and card-linked exceptions.
- [ ] [P0] Inventory every Monster Mutation card and record its exact mechanical effect, timing, duration, target, and stacking rule.
  - [P0] Inventory every Military Research card and record its exact mechanical effect, timing, duration, target, and stacking rule.
- [ ] [P0] Resolve the exact National Guard control-card behaviour from authoritative component evidence.
  - [P0] Identify every rule conflict, omission, or component-dependent special case and assign a visible resolution status.
- [ ] [P1] Document deliberate digital adaptations such as hidden information, simultaneous choices, dice presentation, and disconnect handling.
  - [P1] Complete an IP/content audit separating reference-only physical materials from original, licensed, or safe-to-ship assets and wording.
- [ ] [P1] Define a review and sign-off owner for board data, component data, rules interpretations, and shipped media.

### Milestone 1 acceptance

- [ ] [P0] Every major rulebook heading has at least one mapped implementation and test item.
- [ ] [P0] Every unresolved rule-bearing fact appears in a single reviewed unresolved-inventory list.
- [ ] [P0] No placeholder statistic or invented card effect is labelled production-ready.
- [ ] [P1] A reviewer can trace each production rule datum to its source without using code history.

## Milestone 2 — Canonical hex-board definition and validation

**Priority:** P0  
**Depends on:** Milestone 1 source authority  
**Technical detail:** implement the invariants in [the backend hex-grid plan](docs/backend-hex-grid-plan.md) rather than duplicating them here.

- [ ] [P0] Preserve the current abstract nine-location map as an explicitly named development fixture.
  - [P0] Choose and document the axial-coordinate orientation, origin, row direction, and client conversion convention.
  - [P0] Define versioned board, hex, coordinate, feature, edge, water-class, and barrier types in the shared engine layer.
- [ ] [P0] Author every playable board hex with a stable key, coordinate, water class, label, features, source references, and verification status.
  - [P0] Author explicit reciprocal movement edges instead of deriving legality from visual proximity.
- [ ] [P0] Record lake, sea, seacoast, boundary, disabled, and exceptional edge information.
  - [P0] Record all cities and their exact Health/dice benefits.
- [ ] [P0] Record all military bases and owning branches.
  - [P0] Record all Infamy, Mutation, Challenge, Hollywood, Los Angeles, blank, and lair spaces.
- [ ] [P0] Support multiple composable features on one hex.
  - [P0] Create a generated lookup index and content hash for each immutable board version.
- [ ] [P0] Pin board ID, version, ruleset version, and content hash when a match is created.
  - [P0] Build structural validators for keys, coordinates, edges, reciprocity, neighbours, feature requirements, and source references.
- [ ] [P0] Make production validation fail for unresolved rule-bearing board fields.
  - [P1] Report disconnected regions, isolated spaces, suspicious duplicates, disabled-only reachability, and feature counts for review.
- [ ] [P1] Generate an annotated coordinate map or review table for human comparison with the source board.
  - [P1] Remove all gameplay topology, water-edge data, and rule-marker inventory from the web client.

### Milestone 2 acceptance

- [ ] [P0] The structural validator passes and the remaining unresolved inventory is empty or explicitly blocks release.
- [ ] [P0] Engine, API, and web import one immutable board definition and no client maintains independent topology.
- [ ] [P0] A human reviewer signs off every rule-bearing space, feature, connection, and barrier.
- [ ] [P1] Changing display size or orientation cannot change legal movement.

## Milestone 3 — Deterministic game state, commands, events, and randomness

**Priority:** P0  
**Depends on:** Milestone 2 board primitives

- [ ] [P0] Replace prototype location strings with stable hex keys and explicit off-board positions.
  - [P0] Give every player, monster, physical unit, card, deck entry, battle, and match a stable ID.
  - [P0] Represent record-tile, board, Hollywood, disappeared, trophy, defeated, and permanently removed positions explicitly.
- [ ] [P0] Add a versioned match-state schema and reject unsupported state versions safely.
  - [P0] Store only changing match state; keep static board and component definitions outside snapshots.
- [ ] [P0] Derive occupancy from piece positions while allowing multiple monsters/units where the current rules permit it.
  - [P0] Replace UI-driven phase changes with validated engine commands and explicit pending decisions.
- [ ] [P0] Define a command envelope containing action ID, actor ID, expected revision, command body, and protocol version.
  - [P0] Define typed command results, domain errors, events, and receipts that the UI can interpret without matching error strings.
- [ ] [P0] Remove `Math.random()` and `Date.now()` from rules transitions.
  - [P0] Inject seeded/server-controlled random outcomes through an explicit engine context.
  - [P0] Record enough dice/deck outcomes in events to replay a match deterministically.
- [ ] [P0] Make repeated action IDs idempotent across process restarts, not just within one memory-store lifetime.
  - [P0] Enforce optimistic revision checks before applying commands.
- [ ] [P0] Persist snapshot, event, command receipt, and next revision atomically.
  - [P1] Add event sequence numbers and snapshot/delta recovery semantics.
- [ ] [P1] Define redacted player, opponent, and spectator projections that never reveal deck order or other secrets.
  - [P1] Add schema migration policy for persisted matches and immutable version pinning for in-progress games.

### Milestone 3 acceptance

- [ ] [P0] Replaying the same initial state, commands, and recorded outcomes produces byte-equivalent canonical state.
- [ ] [P0] Concurrency, stale revision, duplicate command, and atomic rollback tests pass in both memory and Prisma stores.
- [ ] [P0] Engine state contains no pixels, percentages, React data, wall-clock IDs, or uncontrolled randomness.
- [ ] [P1] Projection fixtures contain no forbidden hidden information.

## Milestone 4 — Player setup, assignments, and starting pieces

**Priority:** P0  
**Depends on:** Milestones 1–3

- [ ] [P0] Support exactly 2, 3, or 4 player seats and reject other production match sizes.
  - [P0] Randomly determine first player using recorded server randomness.
- [ ] [P0] Calculate the active Stomp stack as 14, 17, or 20 markers from player count.
  - [P0] Create and shuffle Mutation and Research decks deterministically.
- [ ] [P0] Model the neutral National Guard inventory and record-tile position.
  - [P0] Implement ordered selection of one unclaimed monster per player.
- [ ] [P0] Implement reverse-order selection of one eligible non-National-Guard military branch per player.
  - [P0] Prevent duplicate monster and branch assignments.
- [ ] [P0] Create every monster and branch unit from verified component definitions.
  - [P0] Place unselected branch units on their bases for games with fewer than four players.
- [ ] [P0] Let each player choose one of their monster's three valid lairs.
  - [P0] Let each player choose initial deployment or one Military Research draw.
- [ ] [P0] Validate complete inventory accounting before the first turn begins.
  - [P1] Add lobby controls for player count, ready state, seat order, display names, and room privacy.
- [ ] [P1] Define host departure, unready player, duplicate tab, and setup-time disconnect behaviour.
  - [P1] Show a setup summary for confirmation before locking the match configuration.

### Milestone 4 acceptance

- [ ] [P0] Automated fixtures prove legal setup for 2, 3, and 4 players.
- [ ] [P0] Invalid assignments, inventories, lairs, Stomp stacks, and starting choices are rejected by the engine.
- [ ] [P0] A browser user can complete setup without editing state or relying on placeholder defaults.
- [ ] [P1] Reconnecting during setup restores the correct private and shared decisions.

## Milestone 5 — Complete movement and path validation

**Priority:** P0  
**Depends on:** Milestones 2–4

- [ ] [P0] Replace destination-only movement with commands containing the complete intended path.
  - [P0] Validate every path against enabled authored edges and the piece's effective Move value.
  - [P0] Allow the active player to move their monster and any number of eligible branch units separately.
- [ ] [P0] Track moved piece IDs so no piece receives two movement allowances in one Move step.
  - [P0] Support deliberately leaving any eligible piece unmoved.
- [ ] [P0] Require the monster movement decision to be explicitly resolved before ending Move.
  - [P0] Enforce monster stops on entering a space containing any military unit.
- [ ] [P0] Prevent monsters entering or passing through other monsters before the Challenge unless a specific ability permits passage.
  - [P0] Enforce military-unit stops on entering a monster's space.
- [ ] [P0] Allow units to pass through and share spaces with military units.
  - [P0] Enforce Lake, Sea, Sea/Seacoast Only, and ordinary water-barrier restrictions for every path step.
  - [P0] Implement Fly passage and destination exceptions exactly.
- [ ] [P0] Prevent ordinary movement of National Guard units unless a sourced effect grants it.
  - [P0] Implement monster disappearance instead of movement.
- [ ] [P0] Implement next-turn lair return, starting-Health restoration, and entire-Move-step consumption after disappearance.
  - [P0] Prevent disappearance from Hollywood.
- [ ] [P0] Create compulsory pending battles from final movement positions.
  - [P1] Expose legal destinations and valid paths from authoritative engine selectors for UI highlighting.

### Milestone 5 acceptance

- [ ] [P0] Movement matrix tests cover every piece category, ability, barrier, occupancy stop, Challenge state, and off-board state.
- [ ] [P0] Invalid paths cannot partially move a piece or consume its movement allowance.
- [ ] [P0] Ending Move preserves every unselected piece and produces exactly the correct pending battles.
- [ ] [P1] Local and online clients submit the same path command shape and receive the same legality result.

## Milestone 6 — Battles, attacks, damage, retreat, disappearance, and Hollywood

**Priority:** P0 for first-playable combat; P1 for full fidelity  
**Depends on:** Milestones 1, 3, and 5

- [ ] [P0] Represent all battles created during Move and let the active player choose their resolution order.
  - [P0] Make every started battle compulsory, including battles involving a player's own monster and branch.
  - [P0] Implement exactly two combat rounds outside the Monster Challenge.
- [ ] [P0] Enforce monster-first attack order followed by surviving military attacks each round.
  - [P0] Let the correct controlling player make each unit's attack and decision.
- [ ] [P0] Let the active player resolve neutral National Guard attacks unless an implemented effect overrides control.
  - [P0] Implement one-at-a-time targeting so later attacks can react to earlier outcomes.
  - [P0] Resolve hits against Defense and natural-six smash damage.
- [ ] [P0] Enforce legal target types for monsters, normal units, and Challenge combatants.
  - [P0] Allow Infamy spending for additional monster attacks before a roll.
- [ ] [P0] Resolve mutation-causing attacks immediately before later attacks.
  - [P0] Apply monster damage, normal-unit destruction, record-tile return, and giant-unit damage correctly.
  - [P0] Track permanently removed pieces separately from deployable pieces.
- [ ] [P0] Require retreat when military units survive both normal combat rounds.
  - [P0] Enforce retreat adjacency, water, occupancy, entry-space, and choice-owner rules.
- [ ] [P0] Force disappearance when no legal retreat exists and suppress the Encounter step after retreat.
  - [P1] Award Military Research for the qualifying forced-retreat and knockout cases.
  - [P1] Send a pre-Challenge monster at 0 Health to Hollywood and discard its Infamy.
- [ ] [P1] Implement start-of-turn Hollywood recovery rolls and release at 5 or more Health.
  - [P1] Implement valid Hollywood release destinations and Los Angeles occupancy fallback.

### Milestone 6 acceptance

- [ ] [P0] Deterministic combat fixtures cover misses, hits, smashes, sequential targeting, mutations, destruction, retreat, and no-retreat disappearance.
- [ ] [P0] A full battle can be completed through commands without automatic hidden choices.
- [ ] [P1] Hollywood entry, recovery, release, rewards, and restrictions match the rules reference.
- [ ] [P1] The UI and event log identify actor, target, roll, modifiers, damage, destruction, and next required decision.

## Milestone 7 — Encounters, stomping, sites, and board rewards

**Priority:** P0 for first-playable encounters; P1 for full fidelity  
**Depends on:** Milestones 1–3 and 6

- [ ] [P0] Enter Encounter only when movement and all required battles permit it.
  - [P0] Resolve every eligible feature on a multi-feature final space in documented order.
  - [P0] Store stomp state on the hex and prevent the same space being stomped twice.
- [ ] [P0] Take Stomp markers from the active player-count stack before Challenge declaration.
  - [P0] Use extra markers for later stomps without creating a second declaration.
- [ ] [P0] Apply fixed, one-die, two-dice, and three-dice city Health gains with the 40-Health cap.
  - [P0] Grant one Infamy and the correct branch trophy when stomping a military base.
- [ ] [P0] Let the branch owner choose a legal trophy from board or record tile.
  - [P0] Permanently remove trophy units from deployment inventory.
- [ ] [P0] Handle an exhausted branch inventory while still granting Infamy and stomping the base.
  - [P0] Prevent deployment on stomped bases.
- [ ] [P0] Grant two Infamy at an Infamy site and enforce the 15-Infamy cap.
  - [P1] Track Mutation-site use independently for every monster and site.
- [ ] [P1] Draw and immediately apply a Mutation card on first use of a site.
  - [P1] Treat Challenge sites as blank before declaration and apply challenger replacement after declaration.
- [ ] [P1] Make blank spaces, stomped spaces, and lairs produce no encounter effect.
  - [P1] Handle exhausted decks without reshuffling discards.

### Milestone 7 acceptance

- [ ] [P0] Feature tests cover every authored space category and multi-feature combination.
- [ ] [P0] Stomp-stack depletion declares exactly one challenger at the correct time.
- [ ] [P0] Trophy, Infamy, Health, mutation history, and stomp state survive save/reload and replay.
- [ ] [P1] Encounter UI exposes each reward, choice, cap, skipped effect, and resulting Challenge state.

## Milestone 8 — Deployment, National Guard, giant units, and research

**Priority:** P0 for basic deployment; P1 for full fidelity  
**Depends on:** Milestones 1–4 and 7

- [ ] [P0] Read each branch's deployment allowance and permitted mix from verified data.
  - [P0] Enforce physical inventory limits and trophy/permanent-removal exclusions.
  - [P0] Permit at most one newly deployed unit per destination space per turn.
- [ ] [P0] Restrict owned-branch deployment to that branch's unstomped bases.
  - [P0] Allow deployment into a legal space containing a monster and create any resulting future battle state correctly.
- [ ] [P0] Allow ending Deploy after any legal number of deployments up to the allowance.
  - [P0] Implement deployment of neutral National Guard units to unstomped cities, bases, and Infamy sites.
- [ ] [P0] Keep National Guard control neutral after a player deploys it.
  - [P1] Implement redeployment from the board to another legal unstomped owned base.
- [ ] [P1] Count each redeployed unit against the branch allowance.
  - [P1] Prevent redeployment of National Guard and giant units.
- [ ] [P1] Let the active player draw one Military Research card instead of performing any deployment.
  - [P1] Apply immediate Research instructions and expose later-use Research choices.
- [ ] [P1] Introduce Captain Colossal and Mecha-Monster only through their verified card effects.
  - [P1] Implement giant-unit Health, attacks, damage, sharing, and permanent destruction.
- [ ] [P1] Ensure giant-unit placement does not consume the normal one-unit-per-space deployment slot when the rules exempt it.
  - [P1] Implement sourced temporary National Guard control overrides with explicit permissions and expiry.

### Milestone 8 acceptance

- [ ] [P0] Deployment tests cover every branch, player count, base status, inventory boundary, destination collision, and pass option.
- [ ] [P0] Every physical unit is accounted for before and after deploy, trophy, destruction, redeploy, and removal operations.
- [ ] [P1] Research, National Guard overrides, and giant-unit lifecycle tests use verified component fixtures.
- [ ] [P1] The web UI never offers an illegal unit, destination, redeployment, or Research alternative.

## Milestone 9 — Mutation and Military Research card systems

**Priority:** P1  
**Depends on:** Milestones 1, 3, 6–8

- [ ] [P1] Define versioned structured card data separate from presentation copy and artwork.
  - [P1] Represent owner, source deck, zone, visibility, duration, uses, targets, and lifecycle for every card.
- [ ] [P1] Implement deterministic shuffle, draw, reveal, discard, exhaust, and permanent-effect handling.
  - [P1] Keep deck order private in player and spectator projections.
- [ ] [P1] Build a composable effect system for stat modifiers, movement abilities, attack changes, control overrides, placement, and triggered effects.
  - [P1] Define precedence for general rules, component rules, persistent effects, and one-shot effects.
- [ ] [P1] Define stacking and conflict behaviour from sourced card text rather than generic assumptions.
  - [P1] Add explicit commands for optional card timing windows and target selection.
- [ ] [P1] Resolve immediate cards before continuing the interrupted attack, encounter, or deployment sequence.
  - [P1] Track per-turn and per-game card-use restrictions authoritatively.
- [ ] [P1] Implement every verified Monster Mutation card with isolated tests.
  - [P1] Implement every verified Military Research card with isolated tests.
- [ ] [P1] Mark unsupported cards unavailable in production setup instead of silently no-oping them.
  - [P1] Add card detail, source, legal timing, target, confirmation, result, and persistent-effect UI.
- [ ] [P1] Add accessible private-hand/revealed-card presentation without leaking content to opponents or spectators.

### Milestone 9 acceptance

- [ ] [P1] Every production card has structured data, an implemented effect, timing tests, projection tests, and UI coverage.
- [ ] [P1] Deck exhaustion, interrupted resolution, invalid targets, stacked effects, reconnect, and replay tests pass.
- [ ] [P1] A card catalogue report shows zero unsupported cards in the selected production ruleset.
- [ ] [P1] Hidden card and deck information cannot be recovered from room snapshots, events, or browser markup.

## Milestone 10 — Monster Challenge, victory, and rematches

**Priority:** P0 for simplified victory; P1 for complete Challenge  
**Depends on:** Milestones 3–9

- [ ] [P0] Define a temporary first-playable victory condition so a two-player simplified match can end coherently before full Challenge work lands.
  - [P0] Display that temporary victory rule clearly and keep it isolated from the production ruleset.
  - [P1] Declare the monster taking the final active Stomp marker as challenger.
- [ ] [P1] Schedule default Challenge start for the start of that player's next turn.
  - [P1] Allow an eligible monster reaching a Challenge site to replace the challenger and begin the Challenge at turn end.
- [ ] [P1] Preserve challenger status after forced retreat.
  - [P1] Clear challenger status after disappearance or Hollywood and wait for a new eligible Challenge-site arrival.
  - [P1] Exclude Hollywood monsters while keeping disappeared monsters eligible.
- [ ] [P1] Let the challenger choose the next eligible opponent.
  - [P1] Move the selected opponent into the Challenge space and record both weigh-in Health values.
- [ ] [P1] Run unlimited combat rounds with challenger-first attacks and monster-on-monster targeting.
  - [P1] Knock out Challenge losers instead of sending them to Hollywood.
  - [P1] Heal the winner by the loser's weigh-in Health subject to the effective Health cap.
- [ ] [P1] Continue immediately with the surviving monster as challenger until no eligible monster remains.
  - [P1] Fight all surviving giant units last in challenger-selected order.
- [ ] [P1] Award an immediate America-saved victory when a giant unit defeats the monster challenger.
  - [P1] Otherwise award King of the Giant Monsters victory to the last surviving monster.
  - [P1] Freeze further gameplay commands after game over while preserving replay and spectator access.
- [ ] [P1] Store winner, victory type, final standings, duration, ruleset, and terminal event.
  - [P1] Implement rematch setup that creates a new match without leaking or mutating the completed record.

### Milestone 10 acceptance

- [ ] [P0] Two players can finish a first-playable match and receive one authoritative winner.
- [ ] [P1] Challenge fixtures cover default timing, site takeover, lost challenger, Hollywood exclusion, disappeared eligibility, weigh-in healing, giant ordering, and both victory types.
- [ ] [P1] Reconnect and spectator flows render the same terminal result from persisted state.
- [ ] [P1] No legal command can leave a completed match or create two winners.

## Milestone 11 — First-playable web interface

**Priority:** P0 for the checkpoint; P1 for complete rules UI  
**Depends on:** each corresponding engine capability

- [ ] [P0] Split the monolithic prototype into maintainable lobby, setup, board, turn, battle, card, log, and end-game surfaces.
  - [P0] Render all board hexes, features, barriers, labels, and pieces from the authoritative board and match state.
  - [P0] Add pan, zoom, fit-to-board, reset-view, and focus-active-area controls.
- [ ] [P0] Make dense piece stacks selectable and show ownership, branch, Health, and status without obscuring the board.
  - [P0] Show the active player, phase, current substep, pending decision, round, Stomp stack, and Challenge status persistently.
- [ ] [P0] Highlight selectable pieces, reachable hexes, chosen paths, illegal destinations, and movement costs from engine-provided legality.
  - [P0] Support path preview, confirmation, cancellation, and clear server rejection recovery.
  - [P0] Present battle order selection and one-attack-at-a-time target choices.
- [ ] [P0] Animate or sequence dice results without delaying authoritative state indefinitely.
  - [P0] Show damage, smash, destruction, trophy, retreat, disappearance, and Hollywood outcomes visibly.
- [ ] [P0] Present Encounter rewards and Deploy choices as explicit actions rather than generic “advance” buttons.
  - [P0] Provide a readable chronological game log with actor, action, outcome, and expandable detail.
- [ ] [P0] Add first-playable setup, gameplay, victory, restart, and error states.
  - [P0] Prevent double submission and show pending server acknowledgement.
  - [P1] Add private card zones, public persistent effects, timing prompts, and target selection.
- [ ] [P1] Add Monster Challenge opponent selection, weigh-in, duel progression, and final victory presentation.
  - [P1] Add contextual rules help linked to the exact current decision.
- [ ] [P1] Clearly distinguish own pieces, allied branch pieces, enemy pieces, neutral units, active selections, and unavailable actions.
  - [P1] Provide safe leave, concede, return-to-room, and rematch flows.

### Milestone 11 acceptance

- [ ] [P0] Two new players can complete the simplified first-playable flow in supported desktop and mobile browsers without developer assistance.
- [ ] [P0] Browser verification covers every first-playable decision, cancellation, invalid action, loading state, and victory state.
- [ ] [P1] Every full-rules pending-decision type has a dedicated understandable UI and recovery path.
- [ ] [P1] The web client never calculates a rule outcome or maintains independent authoritative state.

## Milestone 12 — Online rooms, persistence, reconnection, and spectators

**Priority:** P0 for two-player rooms and reconnect; P1 for production reliability  
**Depends on:** Milestone 3 and the corresponding gameplay commands

- [ ] [P0] Make room creation use the chosen player count instead of always creating a two-player engine state implicitly.
  - [P0] Prevent gameplay before setup is complete and all required players are ready.
  - [P0] Authenticate every command against participant, seat, phase, and active decision ownership.
- [ ] [P0] Persist all accepted commands atomically through the authoritative engine.
  - [P0] Reconnect a browser to the latest snapshot after refresh, temporary network loss, or WebSocket failure.
- [ ] [P0] Reconcile stale local revisions without duplicate actions or missing events.
  - [P0] Keep polling fallback behaviour correct and stop duplicate polling/socket update loops.
  - [P0] Restore the exact pending private decision for the reconnecting player.
- [ ] [P0] Show connection, reconnecting, offline, stale, and unrecoverable session states.
  - [P1] Define session expiry, revocation, token rotation, and room access policy.
- [ ] [P1] Define room status transitions for waiting, active, completed, abandoned, and expired matches.
  - [P1] Define disconnect grace periods, voluntary concede, inactive-player handling, and host departure.
- [ ] [P1] Support safe multi-tab detection or consistent multi-tab command semantics.
  - [P1] Project WebSocket snapshots and events separately for each player and spectator connection.
  - [P1] Let spectators join without an account while respecting room privacy and hidden information.
- [ ] [P1] Add spectator-focused turn following, board focus, event log, and terminal-state presentation.
  - [P1] Add bounded snapshot/event retention and recovery for long matches.
- [ ] [P1] Verify process restart and deployment do not lose durable rooms or command idempotency.
  - [P1] Add rate limits and abuse controls for create, join, spectate, read, command, and WebSocket operations.

### Milestone 12 acceptance

- [ ] [P0] Two remote browsers can set up, play, refresh, disconnect, reconnect, and finish a match without state divergence.
- [ ] [P0] WebSocket and polling paths pass the same command/revision/reconnect scenarios.
- [ ] [P1] Prisma/Postgres restart, concurrency, idempotency, retention, and projection suites pass.
- [ ] [P1] A spectator can follow a complete match but cannot act or view hidden information.

## Milestone 13 — Responsive design, accessibility, onboarding, feedback, audio, and settings

**Priority:** P1  
**Depends on:** Milestone 11 interaction model

- [ ] [P1] Define supported desktop, tablet, and mobile browser/version targets.
  - [P1] Fit the main decision area within common viewport sizes without mandatory horizontal page scrolling.
  - [P1] Create compact mobile layouts for board, hand, prompts, player status, and log.
- [ ] [P1] Respect safe areas and dynamic viewport height on installed/mobile browsers.
  - [P1] Make all setup and gameplay actions operable by keyboard alone.
- [ ] [P1] Provide visible focus states and predictable focus movement after dialogs and server updates.
  - [P1] Add semantic labels, landmarks, headings, live regions, and useful control names for screen readers.
  - [P1] Provide non-visual descriptions for hex position, neighbours, occupants, features, legal actions, dice, and results.
- [ ] [P1] Ensure ownership, legality, status, and damage are never communicated by colour alone.
  - [P1] Meet WCAG AA contrast and practical target-size requirements for gameplay controls.
- [ ] [P1] Respect `prefers-reduced-motion` and provide equivalent immediate state feedback.
  - [P1] Keep animations interruptible, bounded, and synchronized with authoritative state.
- [ ] [P1] Add first-match onboarding for the goal, setup order, four phases, board controls, and current decision.
  - [P1] Add contextual explanations for why an action is unavailable.
  - [P1] Add confirmation for destructive or irreversible choices without confirming routine safe actions excessively.
- [ ] [P1] Add sound categories for turn, dice, combat, cards, warnings, and victory using original/licensed audio.
  - [P1] Add master, music, effects, and mute controls persisted per browser.
- [ ] [P1] Provide a complete no-audio experience and never rely on sound alone.
  - [P1] Add settings for motion, volume, text/readability preferences, board labels, and confirmation behaviour.

### Milestone 13 acceptance

- [ ] [P1] Complete keyboard-only and screen-reader playthroughs cover setup through victory.
- [ ] [P1] Automated accessibility checks and manual contrast, focus, zoom, reduced-motion, and touch-target reviews pass.
- [ ] [P1] Browser QA passes at agreed desktop, tablet, and mobile viewports with no hidden required controls.
- [ ] [P1] Onboarding can be skipped, revisited, and completed without changing authoritative match state.

## Milestone 14 — Tests, playtesting, operations, security, deployment, and release

**Priority:** P0 for first-playable checks; P1 for public release  
**Depends on:** all release-scope milestones

- [ ] [P0] Expand unit tests for board validators, setup invariants, every phase transition, and deterministic randomness.
  - [P0] Add table-driven legal/illegal tests for movement, combat, encounters, deployment, and victory.
  - [P0] Add API/store contract tests shared by memory and Prisma implementations.
- [ ] [P0] Add end-to-end browser tests for local first playable and two-browser online play.
  - [P0] Add fixed JSON contract fixtures for board keys, commands, events, errors, projections, and snapshots.
  - [P0] Run catalogue verification, engine/API tests, typechecks, production builds, and Markdown/link checks in CI.
- [ ] [P0] Run structured internal playtests and capture rules defects, UX friction, incomplete states, and match duration.
  - [P0] Define first-playable exit criteria and produce an evidence checklist when it is reached.
  - [P1] Add isolated tests for every production Mutation and Research card.
- [ ] [P1] Add property/invariant tests for inventory conservation, legal phase progression, single winner, and replay equivalence.
  - [P1] Add fuzz tests for malformed commands, stale revisions, retries, and reconnect sequences.
  - [P1] Add load tests for concurrent rooms, spectators, WebSockets, polling, persistence, and reconnect storms.
- [ ] [P1] Add browser compatibility and responsive visual-regression coverage.
  - [P1] Add logging with match/action correlation while redacting tokens and private game information.
  - [P1] Add metrics for command failures, latency, reconnects, room completion, abandonment, and server errors.
- [ ] [P1] Add error reporting and alerts for API health, persistence failures, event/snapshot divergence, and deployment regressions.
  - [P1] Threat-model room codes, session tokens, command authorization, enumeration, replay, injection, rate abuse, and secret handling.
  - [P1] Validate CORS, security headers, dependency risks, database permissions, backups, restore, and credential rotation.
- [ ] [P1] Choose hosting only after documenting requirements for static web delivery, WebSockets, durable API compute, Postgres, secrets, and observability.
  - [P1] Create staging and production environments with separate data, secrets, URLs, and deployment safeguards.
  - [P1] Add database migration, rollback, backup, and incompatible-match handling to the release process.
- [ ] [P1] Verify production through real browser create/join/play/reconnect/spectate flows after deployment.
  - [P1] Complete final board-data, rules-fidelity, accessibility, content/IP, privacy, and security sign-offs.
  - [P1] Publish concise player rules, privacy information, known limitations, support route, and release notes.

### Milestone 14 acceptance

- [ ] [P0] First-playable CI is green and a recorded two-player browser playtest reaches a valid winner.
- [ ] [P1] Full release CI, staging soak, production smoke test, backup/restore drill, and security checklist pass.
- [ ] [P1] Board audit, tests, build, deployed service health, and browser QA are reported as separate proof levels.
- [ ] [P1] No unresolved P0/P1 rule datum, unsupported production card, critical accessibility defect, or release-blocking security issue remains.

## Milestone 15 — Post-v1 improvements

**Priority:** Later  
**Depends on:** stable web v1 and playtest evidence

- [ ] [Later] Add optional authenticated profiles without removing guest room play.
  - [Later] Add friend invitations, private links, saved opponents, and presence controls.
- [ ] [Later] Add asynchronous or correspondence matches with explicit turn deadlines.
  - [Later] Add AI opponents at clearly labelled difficulty levels.
- [ ] [Later] Add solo scenarios and rules-learning challenges.
  - [Later] Add match replay navigation, bookmarks, export, and shareable spectator replays.
- [ ] [Later] Add match history and player-facing statistics with privacy controls.
  - [Later] Add additional original boards, monsters, branches, cards, and rulesets through versioned content packs.
- [ ] [Later] Add localization infrastructure and translated UI/rules content.
  - [Later] Add richer original animation, VFX, music, voice, and board themes.
- [ ] [Later] Add installable PWA support, offline reference material, and update prompts.
  - [Later] Add moderation, reporting, blocking, and public-room discovery only if public matchmaking is introduced.
- [ ] [Later] Add tournament/lobby formats only after deterministic rules and operational tooling are mature.
  - [Later] Reuse stable shared contracts for iOS, tvOS, and desktop clients without moving presentation concerns into the engine.
- [ ] [Later] Evaluate native notifications, controller support, large-screen spectator mode, and cross-device hand/board experiences.

### Milestone 15 acceptance

- [ ] [Later] Each post-v1 feature has a validated user need, privacy impact, operating cost, and compatibility plan before implementation.
- [ ] [Later] New clients and content versions pass the same canonical engine-contract and projection fixtures as web v1.

---

## Release checkpoints

### First playable

- [ ] [P0] Verified board data required by the simplified ruleset is complete.
- [ ] [P0] Two players can set up, move, fight, encounter, deploy, and reach the temporary authoritative victory condition.
- [ ] [P0] Local and online play use the same deterministic rules engine and canonical board.
- [ ] [P0] Refresh/reconnect restores the match without duplicate or lost actions.
- [ ] [P0] Desktop and mobile browser playtests complete without developer intervention.
- [ ] [P0] Known simplifications are visible in the UI and cannot be mistaken for full rule fidelity.

### Full web v1

- [ ] [P1] All verified monster, unit, board, card, giant-unit, and Challenge rules are implemented.
- [ ] [P1] Two-, three-, and four-player matches can reach each valid victory type.
- [ ] [P1] Player and spectator projections preserve hidden information throughout live play, reconnect, and replay.
- [ ] [P1] Accessibility, responsive design, security, persistence, observability, and production deployment criteria pass.
- [ ] [P1] Original/licensed art, audio, naming, and wording are approved for release.
- [ ] [P1] The release has no unchecked P0 or P1 item unless it is explicitly removed from the versioned v1 scope with a recorded rationale.
