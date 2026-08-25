# Abominations Attack America — Web Playable Roadmap

This is the delivery checklist for turning the current browser prototype into a complete, understandable, and reliable web game. It is ordered by dependency: later milestones assume the earlier rules, data, and engine foundations are complete.

## Definition of playable

A web version is playable when 2–4 players can create or join a match, complete setup, take every Move/Fight/Encounter/Deploy decision, use the major board and card systems, trigger and finish the Monster Challenge, determine the correct winner, reconnect after interruption, and understand legal actions and outcomes through the interface without consulting developer tools.

The first-playable checkpoint arrives earlier: two players can finish a coherent simplified match from setup to victory on the authoritative, fully filled honeycomb board. The sparse nine-space development topology is a test fixture only and cannot satisfy the MVP playable-game gate. This is a learning milestone, not the full-rules release.

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
- [First-playable browser evidence](docs/first-playable-browser-evidence.md)

## Current-state inventory

| Area | Status | Evidence and limitation |
| --- | --- | --- |
| Shared rules package | Foundation exists | `packages/game-engine` owns a deterministic, simplified four-step development loop with structured battle/encounter/deploy events; full source fidelity remains incomplete. |
| Browser client | Partial prototype | React/Vite renders a playable-looking development board, local turns, room controls, phase prompts, and a log; the MVP must render and play on the fully filled authoritative honeycomb board rather than the sparse nine-space graph. |
| Online rooms | Foundation exists | The API supports create, join, act, read, WebSockets, and polling fallback; production-grade projections, replay, lifecycle, and reconnect handling remain incomplete. |
| Persistence | Foundation exists | In-memory and Prisma stores persist versioned snapshots/events, durable command receipts, terminal results, readiness, and additive schema migration; restart/concurrency/reconnect coverage remains incomplete. |
| Session restoration | Foundation exists | A browser session token is restored from local storage; expiry, revocation, stale revisions, and multi-tab behaviour remain unresolved. |
| Spectators | Foundation exists | No-login spectators can join and read a room; hidden-information projections and complete spectator UX are not yet proven. |
| Rules research | Strong reference base | A consolidated rules reference and component catalogue exist, but several board, record-tile, and card facts remain unresolved. |
| Board | MVP blocker | A staggered 13-row visual lattice (alternating 20/19 cells) and several rule-space markers exist, but the fully filled honeycomb board is not yet authoritatively transcribed, validated, or used for MVP play. |
| Military art | Foundation exists | Original/generated transparent military sprites and a manifest exist; optimized board tiles and reference photographs are manifest-checked, while completeness, consistency, attribution, and final licensing still require review. |
| Automated checks | Thin foundation | Engine and store tests, typechecks, builds, and catalogue verification exist; full rules, browser, persistence, and end-to-end coverage do not. |

---

## Milestone 1 — Rules and source-data audit

**Priority:** P0  
**Depends on:** nothing  
**Outcome:** every rule-affecting implementation input is either sourced and structured or explicitly blocked as unresolved.

- [x] [P0] Create a traceability matrix from every section of the rules reference to engine, UI, and test work. (`docs/rules-traceability-matrix.md`; verified by `npm run traceability:verify`)
  - [x] [P0] Record the source-authority order for rulebook text, board printing, record tiles, cards, and project-specific digital interpretations.
- [x] [P0] Inventory every monster, military branch, National Guard unit, giant unit, marker, token, die, and deck required for 2–4 players. (`docs/component-inventory.md`; verified by `npm run source-audit:verify`)
  - [P0] Transcribe each monster's starting Health, Move, Defense, Damage, Attacks, lairs, and special ability with source references.
- [x] [P0] Transcribe every military unit's quantity, Move, Defense, Damage, Attacks, movement abilities, and special rules. (The complete regular, giant, and National Guard records are typed and source-referenced in `packages/game-engine/src/units.ts`; execution, placement, and exception validation remain separate TODOs.)
  - [P0] Transcribe each branch's unit inventory and deployment allowance/formula from its record tile.
- [x] [P0] Transcribe National Guard statistics and all general placement/control restrictions. (Tank/Fighter quantities, Move values, placement scope, and Guard Commander restriction are typed and source-referenced; enforcement remains source-gated.)
  - [P0] Transcribe Captain Colossal and Mecha-Monster statistics, placement rules, and card-linked exceptions.
- [x] [P0] Inventory every Monster Mutation card and record its exact mechanical effect, timing, duration, target, and stacking rule. (`references/monsters-menace-america/component-rules-catalogue.json`)
  - [x] [P0] Inventory every Military Research card and record its exact mechanical effect, timing, duration, target, and stacking rule. (`references/monsters-menace-america/component-rules-catalogue.json`)
- [x] [P0] Resolve the exact National Guard control-card behaviour from authoritative component evidence. (The exact Guard Commander transcription, continuous timing, duration, and source reference are typed in `SOURCED_CARD_RULES`; its movement/deployment permission is enforced when the card is in the controlling player's hand, while removal/redeployment lifecycle remains gated.)
  - [P0] Identify every rule conflict, omission, or component-dependent special case and assign a visible resolution status.
- [x] [P1] Document deliberate digital adaptations such as hidden information, simultaneous choices, dice presentation, and disconnect handling. (`docs/digital-adaptations.md`)
  - [x] [P1] Complete an IP/content audit separating reference-only physical materials from original, licensed, or safe-to-ship assets and wording. (`docs/content-ip-audit.md`)
- [x] [P1] Define a review and sign-off owner for board data, component data, rules interpretations, and shipped media. (`docs/review-signoff.md`)

### Milestone 1 acceptance

- [x] [P0] Every major rulebook heading has at least one mapped implementation and test item. (`docs/rules-traceability-matrix.md`; verified by `npm run traceability:verify`)
- [x] [P0] Every unresolved rule-bearing fact appears in a single reviewed unresolved-inventory list. (`docs/unresolved-rules-inventory.md`; verified by `npm run source-audit:verify`)
- [x] [P0] No placeholder statistic or invented card effect is labelled production-ready. (Production boundary in `docs/component-inventory.md`)
- [x] [P1] A reviewer can trace each production rule datum to its source without using code history. (`docs/component-inventory.md`, `docs/review-signoff.md`)

## Milestone 2 — Canonical hex-board definition and validation

**Priority:** P0  
**Depends on:** Milestone 1 source authority  
**Technical detail:** implement the invariants in [the backend hex-grid plan](docs/backend-hex-grid-plan.md) rather than duplicating them here.

- [x] [P0] Preserve the current abstract nine-location map as an explicitly named development fixture. (`DEVELOPMENT_LOCATIONS` / `DEVELOPMENT_BOARD`)
  - [x] [P0] Choose and document the axial-coordinate orientation, origin, row direction, and client conversion convention. (`docs/backend-hex-grid-plan.md`)
  - [x] [P0] Define versioned board, hex, coordinate, feature, edge, water-class, and barrier types in the shared engine layer. (`packages/game-engine/src/board.ts`)
- [ ] [P0] Author every playable board hex with a stable key, coordinate, water class, label, features, source references, and verification status.
  - [x] [P0] Author explicit reciprocal movement edges instead of deriving legality from visual proximity. (`DEVELOPMENT_BOARD.edges` is authored from explicit reciprocal development pairs; movement uses its generated index.)
- [ ] [P0] Replace the sparse nine-space development topology with the fully filled authoritative honeycomb board as the MVP playable board. The development fixture may remain for isolated tests, but no first-playable or release flow may use it as the match board.
  - [x] [P0] Establish a complete 254-hex coordinate and adjacency shell from the photographed honeycomb lattice. (`FULL_HONEYCOMB_BOARD`; all printed content remains explicitly unresolved until review.)
  - [x] [P0] Make the fully filled honeycomb board an explicit first-playable MVP gate; sparse nine-space topology is development-only and cannot be used by a playable match or release flow. (`assertMvpBoardReady`/`createMvpRoomGame` reject unresolved full-board data; production Memory/Prisma room stores use that boundary, while tests opt into the named development fixture.)
  - [ ] [P0] Transcribe and verify every interior and boundary hex from the physical board, including all printed spaces, water classes, labels, features, barriers, and off-board edges.
  - [ ] [P0] Make engine, API, and browser MVP matches pin and render the same complete board version and content hash.
  - [ ] [P0] Add a board-comparison evidence pack with annotated full-board imagery, coordinate review, and human sign-off before enabling MVP play. (Generated `docs/board-comparison-overlay.svg` now provides the annotated 254-cell/photo comparison and the review table/checklist; human transcription sign-off remains outstanding.)
    - [x] [P0] Create the source evidence pack, photograph links, 254-cell review summary, and explicit promotion checklist. (`docs/full-honeycomb-board-evidence.md`)
- [ ] [P0] Record lake, sea, seacoast, boundary, disabled, and exceptional edge information.
  - [P0] Record all cities and their exact Health/dice benefits.
- [ ] [P0] Record all military bases and owning branches.
  - [P0] Record all Infamy, Mutation, Challenge, Hollywood, Los Angeles, blank, and lair spaces.
- [x] [P0] Support multiple composable features on one hex. (`BoardHex.features` is a list; validator/index test covers a multi-feature hex)
  - [x] [P0] Create a generated lookup index and content hash for each immutable board version. (`buildBoardIndex`, `boardContentHash`)
- [x] [P0] Pin board ID, version, ruleset version, and content hash when a match is created. (`createGame` stores all four immutable board pins; engine test covers them)
  - [x] [P0] Build structural validators for keys, coordinates, edges, reciprocity, neighbours, feature requirements, and source references. (`validateBoardDefinition` and board tests cover key/coordinate/source/edge/hash invariants)
- [x] [P0] Make production validation fail for unresolved rule-bearing board fields. (Production validation rejects unresolved hexes; board test proves the development fixture is not production-ready)
  - [x] [P1] Report disconnected regions, isolated spaces, suspicious duplicates, disabled-only reachability, and feature counts for review. (`diagnoseBoard` and generated `docs/board-review-table.md`; board diagnostics regression test)
- [x] [P1] Generate an annotated coordinate map or review table for human comparison with the source board. (`docs/board-review-table.md`; regenerated and checked by `npm run board-review:verify`)
  - [x] [P1] Remove all gameplay topology, water-edge data, and rule-marker inventory from the web client. (Web hex visuals now render `DEVELOPMENT_BOARD.hexes`; legal movement still comes only from engine selectors)

### Milestone 2 acceptance

- [x] [P0] The structural validator passes and the remaining unresolved inventory is empty or explicitly blocks release. (`npm run release-blockers:verify` proves the development board fails production validation and all eight unresolved rule IDs remain documented)
- [ ] [P0] Engine, API, and web import one immutable board definition and no client maintains independent topology. (The engine/API state pins `DEVELOPMENT_BOARD`, while the browser also renders the separate unresolved `FULL_HONEYCOMB_BOARD` shell; this remains an explicit mismatch until the promoted board exists.)
- [ ] [P0] A human reviewer signs off every rule-bearing space, feature, connection, and barrier.
- [x] [P0] The fully filled honeycomb board is the only board accepted by the first-playable MVP gate; the sparse nine-space fixture is rejected outside development-only tests. (Production room creation rejects unresolved board validation; development store tests pass `allowDevelopmentFixture: true` explicitly.)
- [x] [P1] Changing display size or orientation cannot change legal movement. (Movement is derived from canonical hex keys and the immutable board edge index; display coordinates are not present in `GameState` or movement commands.)

## Milestone 3 — Deterministic game state, commands, events, and randomness

**Priority:** P0  
**Depends on:** Milestone 2 board primitives

- [x] [P0] Replace prototype location strings with stable hex keys and explicit off-board positions. (Authoritative piece, battle, and stomp positions now use canonical `HexKey` values; `OffBoardPosition` is a discriminated type; schema-1 development snapshots migrate explicitly through `migrateGameState`.)
  - [x] [P0] Give every player, monster, physical unit, card, deck entry, battle, and match a stable ID. (`GameState.players`, deterministic development `matchId`, stable monster/unit/card/battle IDs, and migration tests cover the identity boundary.)
  - [x] [P0] Represent record-tile, board, Hollywood, disappeared, trophy, defeated, and permanently removed positions explicitly. (`SpaceKey`/`OffBoardPosition` define all seven domains; migration and inventory tests preserve the explicit position boundary.)
- [x] [P0] Add a versioned match-state schema and reject unsupported state versions safely. (`MATCH_STATE_SCHEMA_VERSION` guard in `packages/game-engine/src/index.ts`)
  - [x] [P0] Store only changing match state; keep static board and component definitions outside snapshots. (State stores board ID/version/hash/ruleset pins, not board topology or component definitions)
- [x] [P0] Derive occupancy from piece positions while allowing multiple monsters/units where the current rules permit it. (`occupantsAt` is a non-persisted derived view; shared-space coverage is engine-tested)
  - [x] [P0] Replace UI-driven phase changes with validated engine commands and explicit pending decisions. (`GameState.pendingDecision` is recomputed during migration and every phase transition; `applyCommand` validates the matching decision before resolving; regression coverage is in `packages/game-engine/src/index.test.ts`.)
- [x] [P0] Define a command envelope containing action ID, actor ID, expected revision, command body, and protocol version. (`GameCommandEnvelope` in `packages/game-engine/src/index.ts`; web/API wired)
  - [x] [P0] Define typed command results, domain errors, events, and receipts that the UI can interpret without matching error strings. (`CommandResult`, `GameDomainError`, and `CommandReceipt`)
- [x] [P0] Remove `Math.random()` and `Date.now()` from rules transitions. (Seeded engine RNG and monotonic unit sequence in `packages/game-engine/src/index.ts`)
  - [x] [P0] Inject seeded/server-controlled random outcomes through an explicit engine context. (Seed is supplied to `createGame`; RNG cursor is part of `GameState`)
  - [x] [P0] Record enough dice/deck outcomes in events to replay a match deterministically. (Combat rolls and destroyed IDs are emitted by `applyCommand`; replay test covers the deterministic turn slice)
- [x] [P0] Make repeated action IDs idempotent across process restarts, not just within one memory-store lifetime. (Durable `CommandReceipt` model and Prisma-store retry test across store instances)
  - [x] [P0] Enforce optimistic revision checks before applying commands. (Memory and Prisma stores validate `expectedRevision`; stale-envelope test covers rejection)
- [x] [P0] Persist snapshot, event, command receipt, and next revision atomically. (Prisma transaction, unique receipt constraint, and store-level transaction-path test)
  - [x] [P1] Add event sequence numbers and snapshot/delta recovery semantics. (Room event versions are monotonic sequence numbers; `afterVersion` reads return only later events and are regression-tested)
- [x] [P1] Define redacted player, opponent, and spectator projections that never reveal deck order or other secrets. (`projectState` redacts deck order from player and spectator room snapshots; projection test covers both)
  - [x] [P1] Add schema migration policy for persisted matches and immutable version pinning for in-progress games. (`docs/state-migration.md`; engine rejects unsupported schemas and normalizes the additive `eventLog` field)

### Milestone 3 acceptance

- [x] [P0] Replaying the same initial state, commands, and recorded outcomes produces byte-equivalent canonical state. (Seeded combat replay asserts identical serialized terminal state)
- [x] [P0] Concurrency, stale revision, duplicate command, and atomic rollback tests pass in both memory and Prisma stores. (Store tests cover stale revision, durable duplicate receipts, and the Prisma transaction path)
- [x] [P0] Engine state contains no pixels, percentages, React data, wall-clock IDs, or uncontrolled randomness. (State schema uses stable domain values, persisted seed/cursor, and monotonic unit IDs)
- [x] [P1] Projection fixtures contain no forbidden hidden information. (Player/spectator projection tests redact deck order and reject display-geometry fields)

## Milestone 4 — Player setup, assignments, and starting pieces

**Priority:** P0  
**Depends on:** Milestones 1–3

- [x] [P0] Support exactly 2, 3, or 4 player seats and reject other production match sizes. (`createGame` and both room stores validate supported counts; API no longer silently clamps)
  - [x] [P0] Randomly determine first player using recorded server randomness. (`createGame` derives `currentPlayer` from the persisted seed; replay test covers seed determinism)
- [x] [P0] Calculate the active Stomp stack as 14, 17, or 20 markers from player count. (`stompMarkerCount`; engine/API tests cover 2, 3, and 4)
  - [x] [P0] Create and shuffle Mutation and Research decks deterministically. (Source-inventoried card IDs and seed-stable deck order in `GameState`; engine test covers replay)
- [x] [P0] Model the neutral National Guard inventory and record-tile position. (`GameState.nationalGuard` explicitly contains six tank and two fighter IDs, is neutral and located on `record-tile`; statistics, control, and placement remain source-gated.)
  - [x] [P0] Implement ordered selection of one unclaimed monster per player. (`createSetup`/`chooseMonster` enforce seat order and uniqueness from verified definitions)
- [x] [P0] Implement reverse-order selection of one eligible non-National-Guard military branch per player. (`chooseBranch` enforces reverse seat order and eligible-branch input)
  - [x] [P0] Prevent duplicate monster and branch assignments. (Setup tests reject duplicate claims)
- [x] [P0] Create every monster and branch unit from verified component definitions. (All six monster records and all 32 regular branch units are instantiated from the source-backed catalogues; production setup/placement remains source-gated.)
  - [P0] Place unselected branch units on their bases for games with fewer than four players.
- [x] [P0] Let each player choose one of their monster's three valid lairs. (`chooseLair` validates against the supplied verified lair definition and prevents reuse)
  - [x] [P0] Let each player choose initial deployment or one Military Research draw. (`chooseStartingChoice` records exactly one explicit option; deployment legality remains source-definition dependent)
- [x] [P0] Validate complete regular-unit inventory accounting before the first turn begins. (Source-counted regular quantities, structural IDs, positions, battle references, National Guard collisions, and movement ledgers are validated at creation, before commands, and after every successful event transition.)
  - [x] [P0] Validate the source-backed National Guard record-tile quantity. (`createNationalGuardInventory` instantiates six tanks and two fighters with stable IDs; exact quantity/identity conservation and migration restore the canonical eight-piece inventory.)
  - [ ] [P0] Validate giant physical quantities and board placement once authoritative component evidence is resolved. (Giant records remain explicitly source-gated.)
  - [P1] Add lobby controls for player count, ready state, seat order, display names, and room privacy.
- [x] [P1] Define host departure, unready player, duplicate tab, and setup-time disconnect behaviour. (The room lifecycle contract defines creator departure as non-privileged, unready remains waiting-only, connection leases isolate duplicate tabs, and setup disconnect/reconnect preserves the persisted state.)
  - [x] [P1] Show a setup summary for confirmation before locking the match configuration. (Online web rooms render the persisted completed assignments and readiness state before activation)

### Milestone 4 acceptance

- [x] [P0] Automated fixtures prove legal setup for 2, 3, and 4 players. (`packages/game-engine/src/setup.test.ts` covers complete 2-, 3-, and 4-seat fixtures)
- [x] [P0] Invalid assignments, inventories, lairs, Stomp stacks, and starting choices are rejected by the engine. (Setup validation tests reject duplicate assignments, invalid lairs, incomplete choices, and unsupported player counts)
- [x] [P0] A browser user can complete setup without editing state or relying on placeholder defaults. (In-app browser playthrough completed the local source-gated setup choices through the starting choice)
- [x] [P1] Reconnecting during setup restores the correct private and shared decisions. (The room token reconnect path restores the persisted setup snapshot; Memory-store regression coverage verifies the shared setup state and revision survive disconnect/reconnect.)

## Milestone 5 — Complete movement and path validation

**Priority:** P0  
**Depends on:** Milestones 2–4

- [x] [P0] Replace destination-only movement with commands containing the complete intended path. (`GameCommand.move.path` is wired through engine, API, and client normalization)
  - [x] [P0] Validate every path against enabled authored edges and the piece's effective Move value. (Engine validates each development-fixture edge and Move limit)
  - [P0] Allow the active player to move their monster and any number of eligible branch units separately.
- [x] [P0] Track moved piece IDs so no piece receives two movement allowances in one Move step. (`GameState.movedPieceIds` covers monster and development military-unit commands and resets at Deploy; movement-ledger tests cover rejection)
  - [x] [P0] Support deliberately leaving any eligible piece unmoved. (`pass-move` resolves only the monster decision while preserving every unit position; `pass-deploy` preserves inventory; covered by movement/pass tests.)
- [x] [P0] Require the monster movement decision to be explicitly resolved before ending Move. (`pass-move` is an explicit engine command and preserves all unselected units; engine-tested)
  - [x] [P0] Enforce monster stops on entering a space containing any military unit. (Path selectors stop expansion at military occupancy and movement creates a pending battle there)
- [x] [P0] Prevent monsters entering or passing through other monsters before the Challenge unless a specific ability permits passage. (Selectors and movement validation reject other-monster occupancy in the development ruleset)
  - [x] [P0] Enforce military-unit stops on entering a monster's space. (Movement validation rejects paths that pass through occupied military spaces and resolves final occupancy as a battle)
- [x] [P0] Allow units to pass through and share spaces with military units. (Development `legalUnitPaths` permits military occupancy while preserving monster stop rules; movement tests cover shared-space passage)
  - [x] [P0] Enforce Lake, Sea, Sea/Seacoast Only, and ordinary water-barrier restrictions for every path step. (Movement now rejects unresolved water classes/barriers and applies movement-specific lake/sea barrier gates; the full board's source values remain an explicit blocker.)
  - [P0] Implement Fly passage and destination exceptions exactly.
  - [x] [P0] Prevent ordinary movement of National Guard units unless a sourced effect grants it. (The command boundary permits movement only when the active player owns the source-backed Guard Commander card; otherwise Guard IDs are rejected.)
  - [x] [P0] Implement monster disappearance instead of movement. (`disappear-monster` removes the monster for the current turn, consumes Move, and is exposed in the web controls when a verified setup lair exists)
- [x] [P0] Implement next-turn lair return, starting-Health restoration, and entire-Move-step consumption after disappearance. (Completed setup assignments return the monster to its selected lair and restore Health below the printed starting value; physical-board lairs remain source-gated)
  - [x] [P0] Prevent disappearance from Hollywood. (Engine rejects the command and the UI does not offer it for Hollywood)
- [x] [P0] Create compulsory pending battles from final movement positions. (`PendingBattle` is created from final path occupancy and persisted in `GameState`; engine test covers creation and consumption)
  - [x] [P1] Expose legal destinations and valid paths from authoritative engine selectors for UI highlighting. (`legalMonsterPaths`/`legalMonsterDestinations` drive web map affordances and are engine-tested)


### Milestone 5 acceptance

- [ ] [P0] Movement matrix tests cover every piece category, ability, barrier, occupancy stop, Challenge state, and off-board state.
- [x] [P0] Invalid paths cannot partially move a piece or consume its movement allowance. (Engine test asserts rejected paths leave canonical state byte-identical)
- [x] [P0] Ending Move preserves every unselected piece and produces exactly the correct pending battles. (`pass-move` preserves unselected units and movement-created battles remain compulsory; engine-tested)
- [x] [P1] Local and online clients submit the same path command shape and receive the same legality result. (Local and online paths now both use the shared `GameCommand`/`applyCommand` boundary; the API wraps the same command in its revision envelope)

## Milestone 6 — Battles, attacks, damage, retreat, disappearance, and Hollywood

**Priority:** P0 for first-playable combat; P1 for full fidelity  
**Depends on:** Milestones 1, 3, and 5

- [x] [P0] Represent all battles created during Move and let the active player choose their resolution order. (The development engine queues every collision during Move and `resolve-fight.battleId` selects any queued battle first; source-specific ownership/target rules remain unresolved.)
  - [x] [P0] Make every started battle compulsory, including battles involving a player's own monster and branch. (Queued battles remain pending until explicitly resolved; queue tests cover multiple compulsory battles.)
  - [x] [P0] Implement exactly two combat rounds outside the Monster Challenge. (Development `resolveFightResult` records two rounds per selected normal battle; Challenge rules remain unimplemented.)
- [x] [P0] Enforce monster-first attack order followed by surviving military attacks each round. (Each selected development battle resolves monster attacks before surviving-unit counterattacks, except the source-backed Army Missile Launcher first-round pre-monster attack; Air Force Cruise Missiles are destroyed after round one; deterministic replay and queue fixtures cover this development boundary.)
  - [P0] Let the correct controlling player make each unit's attack and decision.
- [x] [P0] Let the active player resolve neutral National Guard attacks unless an implemented effect overrides control. (Battle events record the active player as controller for neutral Guard attackers; Guard deployment and control overrides remain separate source-gated work.)
  - [x] [P0] Implement one-at-a-time targeting so later attacks can react to earlier outcomes. (The development resolver re-reads surviving targets before every attack.)
  - [x] [P0] Resolve hits against Defense and natural-six smash damage. (Seeded development rolls compare against Defense and natural six adds smash damage.)
- [ ] [P0] Enforce legal target types for monsters, normal units, and Challenge combatants. (Normal pre-Challenge battle state now rejects non-military targets for monsters and resolves military attacks only against the battle monster; Challenge target rules remain unimplemented.)
  - [x] [P0] Reject malformed normal battle target references at the command boundary. (Pending battles reject duplicate or non-military target IDs.)
  - [x] [P0] Allow Infamy spending for additional monster attacks before a roll. (`resolve-fight` accepts an explicit `spendInfamy` count, validates and deducts it before rolling, grants the extra first-round attacks, records the spend in the event, and the browser exposes the choice for eligible battles.)
- [ ] [P0] Resolve mutation-causing attacks immediately before later attacks. (Air Force Cruise Missile roll-one triggers now draw a face-up card into the monster player's hand at the attack boundary; card application and subsequent source-backed stat changes remain blocked pending card transcription/effect review.)
  - [P0] Apply monster damage, normal-unit destruction, record-tile return, and giant-unit damage correctly.
  - [P0] Track permanently removed pieces separately from deployable pieces.
- [x] [P0] Require retreat when military units survive both normal combat rounds. (Development normal battles now create a compulsory typed retreat decision after round two; production exceptions remain source-gated.)
  - [x] [P0] Enforce retreat adjacency, water, occupancy, entry-space, and choice-owner rules. (Development options enforce adjacent non-monster destinations and explicit choice ownership; physical water/entry exceptions remain unresolved.)
- [x] [P0] Force disappearance when no legal retreat exists and suppress the Encounter step after retreat. (The typed retreat command permits `disappeared` only when the authoritative option set is empty, returns the unit to the explicit disappeared position, and advances directly to Deploy; regression fixture covers this path.)
  - [P1] Award Military Research for the qualifying forced-retreat and knockout cases.
  - [x] [P1] Send a pre-Challenge monster at 0 Health to Hollywood and discard its Infamy. (The development combat resolver moves a defeated monster to the explicit Hollywood position and clears Infamy.)
- [x] [P1] Implement start-of-turn Hollywood recovery rolls and release at 5 or more Health. (The deterministic turn transition rolls once, restores Health, and consumes the Move step while the monster remains in Hollywood.)
  - [x] [P1] Implement valid Hollywood release destinations and Los Angeles occupancy fallback. (Release prefers Los Angeles and uses the assigned lair when Los Angeles is occupied; missing physical lairs remain source-gated.)

### Milestone 6 acceptance

- [x] [P0] Deterministic combat fixtures cover misses, hits, smashes, sequential targeting, mutations, destruction, retreat, and no-retreat disappearance. (Seeded fixtures now explicitly cover the first four outcomes; existing mutation, destruction, retreat, and forced-disappearance fixtures complete the development combat boundary.)
- [x] [P0] A full normal battle can be completed through commands without automatic hidden choices. (Development multi-unit battles persist each attack target, round, attack number, accumulated rolls, destruction list, and Infamy spend across commands and refresh-compatible state; engine and API regression tests cover completion and continuation. Challenge/full-board source gates remain explicit blockers.)
- [ ] [P1] Hollywood entry, recovery, release, rewards, and restrictions match the rules reference.
- [x] [P1] The UI and event log identify actor, target, roll, modifiers, damage, destruction, and next required decision. (Structured `fight.resolved` events carry attack-level details and next phase; the web event log renders expandable detail)

## Milestone 7 — Encounters, stomping, sites, and board rewards

**Priority:** P0 for first-playable encounters; P1 for full fidelity  
**Depends on:** Milestones 1–3 and 6

- [x] [P0] Enter Encounter only when movement and all required battles permit it. (Phase-specific pending decisions prevent Encounter commands during Move/Fight; the gate and the development feature inventory are regression-tested.)
  - [P0] Resolve every eligible feature on a multi-feature final space in documented order.
  - [x] [P0] Store stomp state on the hex and prevent the same space being stomped twice. (`GameState.stompedLocations` is persisted and encounter tests prove duplicate encounters do not consume a marker twice)
- [ ] [P0] Take Stomp markers from the active player-count stack before Challenge declaration.
  - [P0] Use extra markers for later stomps without creating a second declaration.
- [x] [P0] Apply fixed, one-die, two-dice, and three-dice city Health gains with the 40-Health cap. (Existing development markers are structured as `CityBenefit` data and resolved with seeded dice; Zorb's source-backed city choice is authoritative and UI-exposed; physical-board city benefits remain source-gated.)
  - [x] [P0] Grant one Infamy and the correct branch trophy when stomping a military base. (Development base Encounters grant one Infamy and pause for the owning branch's trophy decision when completed setup assignments are present.)
- [x] [P0] Let the branch owner choose a legal trophy from board or record tile. (The pending trophy decision is owned by the branch participant and offers only eligible branch units.)
  - [x] [P0] Permanently remove trophy units from deployment inventory. (Chosen trophies move to `permanently-removed` and enter `removedUnitIds`.)
- [x] [P0] Handle an exhausted branch inventory while still granting Infamy and stomping the base. (No trophy choice is created when no eligible branch unit remains; the base reward and stomp still resolve.)
  - [x] [P0] Prevent deployment on stomped bases. (The deployment command rejects a stomped branch base before consuming inventory or advancing state; regression coverage is in `normal deployment rejects an already stomped branch base`.)
- [x] [P0] Grant two Infamy at an Infamy site and enforce the 15-Infamy cap. (Development encounter applies the capped reward and records the actual gain; Megaclaw's source-backed three-Infamy exception is implemented and tested; other site-dependent exceptions remain unresolved.)
  - [x] [P1] Track Mutation-site use independently for every monster and site. (`mutationSiteUses` prevents repeat use while leaving card draw/effects source-gated.)
- [ ] [P1] Draw and immediately apply a Mutation card on first use of a site. (First-use site draws are now recorded face up; immediate card effects remain source-gated.)
  - [x] [P1] Treat Challenge sites as blank before declaration. (Challenge-site Encounter is inert and does not consume a Stomp marker.)
  - [ ] [P1] Apply challenger replacement after declaration. (Full Monster Challenge state is still source-backed implementation work.)
- [x] [P1] Make stomped spaces produce no encounter effect. (A second Encounter on an already stomped development space consumes no marker and applies no benefit.)
  - [ ] [P1] Make blank spaces and lairs produce no encounter effect once those physical board features are transcribed. (The current board fixture has no verified blank/lair hexes.)
  - [x] [P1] Handle exhausted decks without reshuffling discards. (`drawCard` exhausts without moving discard cards back into the deck; lifecycle tests cover this.)

### Milestone 7 acceptance

- [x] [P0] Feature tests cover every authored space category and multi-feature combination. (Development board tests cover city, military-base, Infamy-site, mutation-site, and Challenge-site categories; the board validator covers composable multi-feature hexes. Production-board coverage remains source-gated.)
- [ ] [P0] Stomp-stack depletion declares exactly one challenger at the correct time.
- [x] [P0] Trophy, Infamy, Health, mutation history, and stomp state survive save/reload and replay. (An encounter-to-trophy fixture serializes through `migrateGameState`, verifies each persisted field, and applies the same trophy command after reload with byte-equivalent resulting state.)
- [ ] [P1] Encounter UI exposes each reward, choice, cap, skipped effect, and resulting Challenge state.

## Milestone 8 — Deployment, National Guard, giant units, and research

**Priority:** P0 for basic deployment; P1 for full fidelity  
**Depends on:** Milestones 1–4 and 7

- [x] [P0] Read each branch's deployment allowance and permitted mix from verified data. (The four photographed branch deployment records are typed as `BRANCH_DEPLOYMENT_DEFINITIONS` and covered by catalogue tests; enforcing those allowances remains a separate deployment TODO.)
  - [x] [P0] Enforce physical inventory limits and trophy/permanent-removal exclusions. (Typed inventory counts, deployment record-tile checks, and trophy removal prevent reuse.)
  - [x] [P0] Permit at most one newly deployed unit per destination space per turn. (The command boundary rejects duplicate destinations for both branch and National Guard deployment.)
- [x] [P0] Restrict owned-branch deployment to that branch's unstomped bases. (Deployment enforces the active branch's verified base and rejects stomped destinations.)
  - [x] [P0] Allow deployment into a legal space containing a monster and create any resulting future battle state correctly. (Deployment creates or extends a compulsory pending battle at the occupied destination.)
- [x] [P0] Allow ending Deploy after any legal number of deployments up to the allowance. (`pass-deploy` is an explicit development command; deployment/pass turn coverage is engine-tested)
  - [x] [P0] Implement deployment of neutral National Guard units to unstomped cities, bases, and Infamy sites. (`deploy` accepts a verified Guard unit ID and destination; legal classes, stomp state, collision, and source inventory boundaries are enforced.)
- [x] [P0] Keep National Guard control neutral after a player deploys it. (Deployed Guard records have no owner player; attacks remain active-player controlled, while Guard Commander is the explicit movement/deployment exception.)
  - [P1] Implement redeployment from the board to another legal unstomped owned base.
- [ ] [P1] Count each redeployed unit against the branch allowance.
  - [P1] Prevent redeployment of National Guard and giant units.
  - [x] [P1] Let the active player draw one Military Research card instead of performing any deployment. (Deploy-phase `draw-research` draws deterministically into the active player's face-up Research hand, ends Deploy, and is exposed in the browser; deck exhaustion is rejected without state mutation.)
  - [P1] Apply immediate Research instructions and expose later-use Research choices.
- [ ] [P1] Introduce Captain Colossal and Mecha-Monster only through their verified card effects.
  - [P1] Implement giant-unit Health, attacks, damage, sharing, and permanent destruction.
- [ ] [P1] Ensure giant-unit placement does not consume the normal one-unit-per-space deployment slot when the rules exempt it.
  - [P1] Implement sourced temporary National Guard control overrides with explicit permissions and expiry. (The continuous Guard Commander permission is implemented; temporary overrides remain source-gated.)

### Milestone 8 acceptance

- [x] [P0] Deployment tests cover every branch, player count, base status, inventory boundary, destination collision, and pass option. (Table-driven engine coverage now exercises 2/3/4-player fixtures and every branch; branches without a verified development base must fail closed, while deployed branches cover inventory, collision, stomp, and explicit pass boundaries.)
- [ ] [P0] Every physical unit is accounted for before and after deploy, trophy, destruction, redeploy, and removal operations.
- [ ] [P1] Research, National Guard overrides, and giant-unit lifecycle tests use verified component fixtures.
- [ ] [P1] The web UI never offers an illegal unit, destination, redeployment, or Research alternative.

## Milestone 9 — Mutation and Military Research card systems

**Priority:** P1  
**Depends on:** Milestones 1, 3, 6–8

- [x] [P1] Define versioned structured card data separate from presentation copy and artwork. (`CARD_DATA_VERSION` and `CARD_DEFINITIONS` keep source-inventory metadata separate; every effect remains explicitly source-gated)
  - [x] [P1] Represent owner, source deck, zone, visibility, duration, uses, targets, and lifecycle for every card. (`CardDefinition` carries each field; unresolved values remain explicit `unknown`/`source-gated`)
- [ ] [P1] Implement deterministic shuffle, draw, reveal, discard, exhaust, and permanent-effect handling.
  - [x] [P1] Keep deck order private in player and spectator projections. (`projectState` removes internal order and discard contents for both audiences; projection tests cover both.)
- [ ] [P1] Build a composable effect system for stat modifiers, movement abilities, attack changes, control overrides, placement, and triggered effects.
  - [P1] Define precedence for general rules, component rules, persistent effects, and one-shot effects.
- [ ] [P1] Define stacking and conflict behaviour from sourced card text rather than generic assumptions.
  - [P1] Add explicit commands for optional card timing windows and target selection.
- [ ] [P1] Resolve immediate cards before continuing the interrupted attack, encounter, or deployment sequence.
  - [P1] Track per-turn and per-game card-use restrictions authoritatively.
- [ ] [P1] Implement every verified Monster Mutation card with isolated tests.
  - [P1] Implement every verified Military Research card with isolated tests.
- [x] [P1] Mark unsupported cards unavailable in production setup instead of silently no-oping them. (`assertCardsAvailable` rejects source-gated card IDs before rules execution)
  - [P1] Add card detail, source, legal timing, target, confirmation, result, and persistent-effect UI.
- [x] [P1] Add accessible private-hand/revealed-card presentation without leaking content to opponents or spectators. (The browser shows the viewer's own card surface; viewer-aware engine/API projections redact other hands, deck order, card IDs in event details, and card IDs in room events.)

### Milestone 9 acceptance

- [ ] [P1] Every production card has structured data, an implemented effect, timing tests, projection tests, and UI coverage.
- [ ] [P1] Deck exhaustion, interrupted resolution, invalid targets, stacked effects, reconnect, and replay tests pass.
- [ ] [P1] A card catalogue report shows zero unsupported cards in the selected production ruleset.
- [x] [P1] Hidden card and deck information cannot be recovered from room snapshots, events, or browser markup. (Projection and MemoryRoomStore tests cover opponent, spectator, event-log, and room-event redaction.)

## Milestone 10 — Monster Challenge, victory, and rematches

**Priority:** P0 for simplified victory; P1 for complete Challenge  
**Depends on:** Milestones 3–9

- [x] [P0] Define a temporary first-playable victory condition so a two-player simplified match can end coherently before full Challenge work lands. (Final active Stomp marker ends the development ruleset with one winner)
  - [x] [P0] Display that temporary victory rule clearly and keep it isolated from the production ruleset. (Terminal `Victory · <monster>` phase label and `development-stomp-exhaustion` state)
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
  - [x] Freeze further gameplay commands after game over while preserving replay and spectator access. (The engine rejects post-terminal commands and the terminal result is persisted/projected by the room stores; terminal freeze is engine-tested)
- [x] [P1] Store winner, victory type, final standings, duration, ruleset, and terminal event. (Prisma terminal results now persist a structured summary containing all six fields; the terminal-result test verifies the exact summary for the development victory.)
  - [P1] Implement rematch setup that creates a new match without leaking or mutating the completed record.

### Milestone 10 acceptance

- [x] [P0] Two players can finish a first-playable match and receive one authoritative winner. (Engine temporary-victory test and Prisma terminal-result test cover one authoritative winner; browser setup/playtest acceptance remains separate)
- [ ] [P1] Challenge fixtures cover default timing, site takeover, lost challenger, Hollywood exclusion, disappeared eligibility, weigh-in healing, giant ordering, and both victory types.
- [x] [P1] Reconnect and spectator flows render the same terminal result from persisted state. (Memory-store terminal flow refreshes a player snapshot and reads the same winner/victory through a spectator projection; hidden deck order remains redacted)
- [x] [P1] No legal command can leave a completed match or create two winners. (The engine rejects every command at the terminal boundary and a table-driven regression test proves the terminal snapshot and winner remain unchanged.)

## Milestone 11 — First-playable web interface

**Priority:** P0 for the checkpoint; P1 for complete rules UI  
**Depends on:** each corresponding engine capability

- [ ] [P0] Split the monolithic prototype into maintainable lobby, setup, board, turn, battle, card, log, and end-game surfaces.
  - [x] Extract stable settings, board-reference, and terminal-summary surfaces without changing authoritative behavior. (`apps/web/src/components/`; web typecheck/build and browser rendering pass.)
  - [x] Extract the unit, revealed-card, and chronological-log surfaces without moving command authority into the UI. (`apps/web/src/components/UnitCard.tsx`, `RevealedCardsPanel.tsx`, and `LogPanel.tsx`; web typecheck/build pass.)
  - [x] Extract the online-room lobby surface while keeping session, room, and readiness callbacks in `App`. (`apps/web/src/components/LobbyPanel.tsx`; web typecheck/build pass.)
  - [x] [P0] Create a clean, art-led Home Screen that gives players an immediate, uncluttered entry point into the game. (`apps/web/src/components/HomeScreen.tsx`; full verification passes.)
    - [x] Add an explicit home entry state with the optimized setup artwork, Development Playtest, Create, Join, Spectate, and Rules actions before the board is shown. (`apps/web/src/components/HomeScreen.tsx`; web typecheck/build pass.)
    - [x] [P0] Give the Home Screen a strong piece of appropriate game art and a cohesive visual hierarchy without overwhelming the available actions. (`/assets/board/full-game-setup.webp` is used as the hero artwork.)
    - [x] [P0] Make the primary Home Screen actions clearly accessible: Join a game, Create a game, and Rules. (`HomeScreen` and `LobbyPanel` expose named keyboard-operable buttons.)
    - [x] [P0] Let players open a concise rules reference from the Home Screen so they can remind themselves how to play before joining or creating a match. (`HomeScreen` Rules panel.)
    - [x] [P0] Use the created artwork assets for hexes, Stomps, Infamy, Military Research cards, Mutation cards, monsters, and troops in the gameplay UI, with the relevant assets visible on the board wherever those components are present. (`HexGrid`, `RevealedCardsPanel`, `PlayerStatusControls`, and the board-asset manifest verification cover the available source-backed artwork.)
      - [x] Show optimized source artwork for revealed Military Research and Monster Mutation card zones while retaining redacted hidden-card data and source-gated effect wording. (`RevealedCardsPanel` and `public/assets/cards/`.)
      - [x] Render optimized source-backed monster sprites on occupied board hexes and the player status control, with accessible name fallbacks. (`HexGrid`, `PlayerStatusControls`, and `public/assets/monsters/`.)
      - [x] Render the optimized Infamy token on verified development Infamy spaces while keeping the feature/encounter data authoritative. (`HexGrid` uses `/assets/board/tokens/infamy_token.webp`.)
      - [x] Keep the artwork renderer covered by the web source contract so monster, Infamy, and revealed-card assets remain present and accessible. (`verify-web-accessibility.mjs` checks the renderer markers.)
    - [x] Render the available optimized board-feature, Stomp-token, city, and military-piece WebP assets in the authoritative hex renderer without changing board legality or unresolved feature data. (`apps/web/src/components/HexGrid.tsx`; web typecheck/build pass.)
    - [x] [P0] Render the board as a connected proper game-board layout of hexagons, with a consistent small border/gap between neighbouring hexes so the board structure is immediately legible. (Flat-top landscape tiles use a 0.15% horizontal micro-gap, staggered rows, and validated bounds.)
    - [ ] [P0] Keep board artwork, piece artwork, markers, and card/component artwork crisp and correctly scaled at the supported zoom levels without obscuring board occupancy or legal interactions.
    - [ ] [P0] Preserve the authored artwork's visual identity and use asset fallbacks only when an asset is genuinely unavailable; do not replace the created assets with generic placeholders in the playable board view.
    - [x] [P0] Label the board's Mutation spaces and cities clearly in the board view. (`HexGrid` renders verified city names/markers and Mutation badges without assigning unresolved shell data.)
      - [x] [P0] Show each city's authored name and its relevant printed benefit/number directly on or immediately beside the city hex, using clear notation such as `1 HP` and `1D` where applicable. (`HexGrid` renders the verified development city marker beside the authored city name.)
      - [x] [P0] Keep city and Mutation labels legible at supported zoom levels and available through accessible text/inspection without hiding the underlying hex, piece, or interaction state. (`HexGrid` renders a Mutation badge and includes city benefit/Mutation context in each hex's accessible name.)
      - [x] [P0] Use only verified board data for city names, Mutation spaces, and benefit values; unresolved values remain visibly marked as `Unresolved <hex key>` rather than guessed. (`HexGrid` preserves authored development labels and marks unresolved shell cells explicitly.)
  - [x] [P0] Remove the background reference-board image from the site and replace it with a generated North America-inspired green hexagon map with a surrounding sea treatment, used only as the decorative background behind the actual map tiles. (`apps/web/src/styles.css`; full verification passes.)
    - [x] [P0] Remove the photographic reference backdrop and use a generated CSS sea, green-land silhouette, and hex-texture treatment beneath the map tiles. (`apps/web/src/main.tsx` and `apps/web/src/styles.css`; web build pass.)
    - [x] [P0] Render the authoritative playable map tiles above this generated background, with the actual connected hexes, borders, labels, pieces, features, and interactions remaining visible and usable. (`.map-canvas` remains above the decorative layers.)
    - [x] [P0] Keep the generated background purely visual and separate from authoritative board topology and rule data; the engine remains the source of playable hexes, adjacency, features, and legality. (The decorative CSS contains no board keys or rule data.)
  - [x] Extract development setup choices and the online setup summary while keeping setup commands and state transitions in `App`. (`apps/web/src/components/SetupPanel.tsx`; web typecheck/build pass.)
  - [x] Extract match status and piece-stack inspection presentation without moving board selection or engine legality into the component. (`apps/web/src/components/MatchStatus.tsx` and `PieceStackInspector.tsx`; web typecheck/build pass.)
  - [x] Extract the 254-cell hex renderer while keeping path selection and engine-provided legality at the parent boundary. (`apps/web/src/components/HexGrid.tsx`; web typecheck/build and `web-board-layout:verify` pass.)
  - [x] Extract the current-step prompt, unavailable-action explanation, and recorded combat-result presentation without moving action controls. (`apps/web/src/components/TurnPrompt.tsx`; web typecheck/build pass.)
  - [x] Extract Fight, Encounter, and Deploy decision controls while keeping command execution and engine legality at the parent boundary. (`apps/web/src/components/PhaseActions.tsx`; web typecheck/build pass.)
  - [ ] [P0] Make the overall UI fit within the viewport as a general rule, with no gameplay page scrolling; scrolling may be used inside menus or other deliberately bounded information panels.
    - [x] [P0] Provide a focused setup screen before the match, then keep the active game view centred on the board/map once gameplay begins. (`HomeScreen` gates entry; `SetupPanel` owns the pre-match fixture choices; the active match layout centres the map panel.)
    - [x] [P0] Make the in-game map draggable/pannable and zoomable, with the board remaining the primary centre-stage interaction surface. (Arrow controls, pointer-drag panning, wheel zoom, and Fit / reset are implemented on the map viewport; hex buttons retain click selection.)
    - [ ] [P0] Make movement and targeting begin by selecting a piece: highlight the selected piece and show a bottom-of-screen detail tray with its name, role, useful stats, and what it does.
      - [x] Allow a movable owned or Guard-controlled unit to be selected directly from its board hex; the engine's legal-path selector remains the selection gate. (`HexGrid` uses `legalUnitPaths`-derived selectable IDs.)
      - [x] Show the selected military piece, source-backed movement/combat stats, path-preview state, and a deselect action in a board-bottom detail tray; selection remains parent-owned and authoritative. (`apps/web/src/components/SelectedPieceTray.tsx`; web typecheck/build pass.)
      - [x] [P0] Show a live arrow/path preview that follows the pointer after selection, then let the player click the intended destination or target to confirm the choice. (`HexGrid` previews the shortest authoritative legal path on destination hover; click still commits the selected path only through the parent command flow.)
        - [x] Draw the selected authoritative path as a visible arrow overlay over the honeycomb before confirmation; clearing the selection removes the preview. (`apps/web/src/components/HexGrid.tsx`; web typecheck/build and board-layout verification pass.)
      - [ ] [P0] Animate the selected unit travelling to its confirmed destination, or animate the targeting/action result, only after the authoritative command is accepted; rejected or cancelled choices must not animate as completed actions.
        - [x] Animate the accepted movement route and destination piece only after `sendCommand` or `applyCommand` succeeds; rejected and cancelled paths never arm the animation. (`apps/web/src/main.tsx` and `apps/web/src/components/HexGrid.tsx`; engine/API tests plus web typecheck/build pass.)
    - [ ] [P0] Add a tactile 3D dice graphic that players can roll for combat, encounters, and other dice-based decisions.
      - [x] Present authoritative combat rolls as tactile 3D dice with recorded hit, damage, smash, and modifier outcomes; the presentation cannot determine the result and respects reduced-motion settings. (`TurnPrompt` renders the recorded `fight.resolved` event.)
      - [ ] [P0] Texture each face of the 3D die with the generated artwork asset for that side, including the correct face orientation and readable scaling during the roll and final result.
      - [ ] [P0] Animate the 3D dice roll and then clearly present the resulting face/value, modifiers, damage, and outcome; the presentation must respect reduced-motion settings.
      - [ ] [P0] Keep the dice result authoritative and deterministic from the engine/server outcome; the 3D animation must be presentation-only and cannot determine or alter the roll.
    - [ ] [P0] Provide a prominent bottom-right action control styled as a push-to-take-action button for the current legal decision.
      - [x] Add a bottom-right action dock that confirms selected movement or executes only unambiguous phase commands; unresolved target/choice states remain disabled with an explanatory label. (`apps/web/src/components/ActionDock.tsx`; web typecheck/build pass.)
    - [ ] [P0] Add a top phase-progress bar that moves through the phases/substeps of the active player's turn.
      - [x] Render authoritative Move, Fight, Encounter, and Deploy progress plus pending attack/retreat/battle/trophy/reward substeps. (`apps/web/src/components/TurnProgress.tsx`; web typecheck/build pass.)
    - [ ] [P0] Place the player's monster and military branch in circular status controls at bottom left, showing useful summary numbers such as Health, Infamy, deployed groups, and reserve groups.
      - [x] Add compact monster and branch status controls with health/Infamy and deployed/reserve summaries, plus keyboard-accessible lightbox detail views. (`apps/web/src/components/PlayerStatusControls.tsx`; web typecheck/build pass.)
    - [ ] [P0] Expand the bottom-left monster and military controls into lightbox-style detail views containing the key information without permanently covering the map.
      - [x] Provide dismissible detail views anchored above the status controls without covering the board by default. (`apps/web/src/components/PlayerStatusControls.tsx`; web typecheck/build pass.)
  - [P0] Render all board hexes, features, barriers, labels, and pieces from the authoritative board and match state.
    - [x] Keep the candidate shell's landscape row geometry, flat-top orientation, odd-row offset, and non-overlapping tile bounds deterministic and separate from rules coordinates. (`buildDisplayHexLayout`; verified by `npm run web-board-layout:verify`)
  - [x] [P0] Add pan, zoom, fit-to-board, reset-view, and focus-active-area controls. (Accessible board-view controls provide directional pan, bounded zoom, and Fit/reset in the browser; focus-active-area remains the current highlighted selection.)
- [x] [P0] Make dense piece stacks selectable and show ownership, branch, Health, and status without obscuring the board. (The accessible Piece Stacks inspector lists occupied hexes and exposes every monster/unit detail without overlaying the board; source-gated fields remain labelled as unavailable.)
  - [P0] Show the active player, phase, current substep, pending decision, round, Stomp stack, and Challenge status persistently.
- [x] [P0] Highlight reachable destinations and illegal destinations from engine-provided legality. (Engine selectors now drive reachable map controls)
- [x] [P0] Highlight selectable pieces, chosen paths, and movement costs from engine-provided legality. (Web uses authoritative paths for destination affordances, selected path highlighting, and cost text)
  - [x] [P0] Support path preview, confirmation, and cancellation. (Web path selection submits only after explicit confirmation and supports cancel)
  - [x] [P0] Clear server rejection recovery. (Online command errors refresh the authoritative room before retry)
  - [x] [P0] Present battle order selection and one-attack-at-a-time target choices. (Battle order and every normal multi-unit attack target are explicit and persisted; pending-target invariants reject stale or forged references; the browser presents each subsequent target decision.)
- [x] [P0] Animate or sequence dice results without delaying authoritative state indefinitely. (The browser now sequences the recorded fight rolls as a presentation-only result strip keyed to the authoritative event; `prefers-reduced-motion` disables the animation.)
  - [P0] Show damage, smash, destruction, trophy, retreat, disappearance, and Hollywood outcomes visibly.
- [x] [P0] Present Encounter rewards and Deploy choices as explicit actions rather than generic “advance” buttons. (Phase-specific command types are emitted after client normalization; `advance` remains compatibility-only in the engine)
  - [x] [P0] Provide a readable chronological game log. (Engine appends events and UI shows the latest entries in chronological order)
  - [x] [P0] Add actor, action, outcome, and expandable event detail to the game log. (Engine event entries are actor-addressable and the web log renders expandable JSON detail)
- [x] [P0] Add first-playable setup, gameplay, victory, restart, and error states. (Local browser flow now exposes source-gated development setup, persists completed assignments into `GameState`, and retains gameplay/victory/restart/error states; production setup remains blocked by unresolved source data)
  - [x] [P0] Prevent double submission and show pending server acknowledgement. (`pendingAction` disables actionable controls and changes the persistent phase status)
  - [x] [P1] Add private card zones, public persistent effects, timing prompts, and target selection. (Player projections expose only the viewer's face-up card zone; spectators and other players receive redacted hands, while the browser labels revealed cards and source-gated effects explicitly.)
- [ ] [P1] Add Monster Challenge opponent selection, weigh-in, duel progression, and final victory presentation.
  - [P1] Add contextual rules help linked to the exact current decision.
- [x] [P1] Clearly distinguish own pieces, allied branch pieces, enemy pieces, neutral units, active selections, and unavailable actions. (The stack inspector exposes semantic ownership labels and a text legend; unit controls expose selected/available state and disabled action labels, with textual ownership/legality retained independently of colour.)
  - [ ] [P1] Provide safe leave, concede, return-to-room, and rematch flows. (Safe Leave room now marks the participant disconnected when reachable, clears the local session, and returns to the lobby; concede, return-to-room after terminal state, and rematch still require explicit product/rules decisions.)
    - [x] Confirm leaving an active online match before marking the seat disconnected; terminal return-to-lobby remains immediate. (`leaveRoomSafely` reuses the irreversible-action preference.)
    - [x] [P1] Provide terminal return and local rematch actions. (Completed online rooms expose Return to lobby; local terminal playtests expose Start another local playtest and reset through the same development setup path.)

### Milestone 11 acceptance

- [ ] [P0] Two new players can complete the simplified first-playable flow in supported desktop and mobile browsers without developer assistance. (The browser now labels its sparse-fixture path as `Development playtest`; online production room creation correctly fails closed until the full board is promoted.)
- [ ] [P0] The first-playable browser flow renders and uses the fully filled authoritative honeycomb board; the sparse nine-space topology is not exposed as an MVP match option.
- [ ] [P0] Browser verification covers every first-playable decision, cancellation, invalid action, loading state, and victory state.
- [ ] [P1] Every full-rules pending-decision type has a dedicated understandable UI and recovery path.
- [ ] [P1] The web client never calculates a rule outcome or maintains independent authoritative state.

## Milestone 12 — Online rooms, persistence, reconnection, and spectators

**Priority:** P0 for two-player rooms and reconnect; P1 for production reliability  
**Depends on:** Milestone 3 and the corresponding gameplay commands

- [x] [P0] Make room creation use the chosen player count instead of always creating a two-player engine state implicitly. (Web lobby selects 2/3/4 and sends the selected count; API and store tests validate it)
  - [x] [P0] Prevent gameplay before setup is complete and all required players are ready. (Both stores keep rooms waiting until every configured player is seated and explicitly ready; waiting-room action test covers rejection)
  - [x] [P0] Authenticate every command against participant, seat, phase, and active decision ownership. (Both stores authenticate token/participant/role/seat; the engine enforces phase legality and tests cover spectator, stale, and illegal actions)
- [x] [P0] Persist all accepted commands atomically through the authoritative engine. (Memory and Prisma stores call `applyCommandEnvelope`; Prisma transaction persists snapshot, event, receipt, and terminal result)
  - [P0] Reconnect a browser to the latest snapshot after refresh, temporary network loss, or WebSocket failure.
  - [x] [P0] Reconcile stale local revisions without duplicate actions or missing events. (Command failures refresh the authoritative room snapshot before retry; stale-envelope and revisioned-delta API tests cover the server boundary)
  - [x] [P0] Keep polling fallback behaviour correct and stop duplicate polling/socket update loops. (Guarded single polling interval starts on WebSocket failure and is cleared on reconnect/cleanup)
  - [x] Restore the exact pending private decision for the reconnecting player. (Refresh regression coverage serializes a multi-unit `attack-target` decision and verifies the pending decision, target state, and revision are restored byte-for-byte.)
- [x] [P0] Show connection, reconnecting, offline, stale, and unrecoverable session states. (Web lobby renders connection state; session restore and command failures retain explicit error text)
  - [P1] Define session expiry, revocation, token rotation, and room access policy.
- [x] [P1] Define room status transitions for waiting, active, completed, abandoned, and expired matches. (Memory and Prisma stores implement the documented 24-hour idle expiry and preserve completed terminal rooms; `docs/room-lifecycle.md` records the transition table.)
  - [P1] Define disconnect grace periods, voluntary concede, inactive-player handling, and host departure.
    - [x] [P1] Implement a confirmed voluntary concession that records a terminal winner and survives room projection/reconnect. (`concede` is an authoritative engine command with `match.conceded` event payload and terminal room status; engine/API coverage added.)
- [x] [P1] Support safe multi-tab detection or consistent multi-tab command semantics. (Session-scoped connection leases prevent stale-tab presence clears; optimistic revisions and action IDs keep duplicate commands safe.)
  - [x] Project WebSocket snapshots and events separately for each player and spectator connection. (The WebSocket registry now retains each connection token and regenerates `getRoom` per socket on every broadcast, so no player projection is reused for another viewer; HTTP projection tests cover the same redaction boundary.)
  - [P1] Let spectators join without an account while respecting room privacy and hidden information.
- [x] [P1] Add spectator-focused turn following, board focus, event log, and terminal-state presentation. (Spectator projections render the active monster/phase, active-location board focus, chronological event log, and terminal result while `canAct` disables all gameplay controls; spectator-read and terminal projection tests cover the boundary.)
  - [P1] Add bounded snapshot/event retention and recovery for long matches.
- [ ] [P1] Verify process restart and deployment do not lose durable rooms or command idempotency.
  - [x] Add rate limits and abuse controls for create, join, spectate, read, command, and WebSocket operations. (The API applies bounded source-address HTTP and WebSocket handshake limits, returns explicit retry/close signals, and has deterministic limiter tests; distributed production enforcement remains a deployment requirement.)

### Milestone 12 acceptance

- [ ] [P0] Two remote browsers can set up, play, refresh, disconnect, reconnect, and finish a match without state divergence.
- [ ] [P0] WebSocket and polling paths pass the same command/revision/reconnect scenarios.
- [ ] [P1] Prisma/Postgres restart, concurrency, idempotency, retention, and projection suites pass.
- [ ] [P1] A spectator can follow a complete match but cannot act or view hidden information.

## Milestone 13 — Responsive design, accessibility, onboarding, feedback, audio, and settings

**Priority:** P1  
**Depends on:** Milestone 11 interaction model

- [x] [P1] Define supported desktop, tablet, and mobile browser/version targets. (`docs/browser-support.md`)
  - [x] Fit the main decision area within common viewport sizes without mandatory horizontal page scrolling. (The responsive layout was checked at a 390×844 viewport; the scrolling client and content widths match and the compact lobby/guide stack fits the mobile surface.)
  - [x] Create compact mobile layouts for board, hand, prompts, player status, and log. (Responsive CSS collapses the main grid, onboarding, status, and controls; the mobile browser preview rendered the compact stacked layout.)
- [x] [P1] Respect safe areas and dynamic viewport height on installed/mobile browsers. (Uses `100dvh` and safe-area insets)
  - [P1] Make all setup and gameplay actions operable by keyboard alone.
- [x] [P1] Provide visible focus states. (Global `:focus-visible` treatment)
  - [x] [P1] Add predictable focus movement after dialogs and server updates. (The current-step heading receives focus after phase, round, and authoritative room-version changes)
  - [x] [P1] Add semantic labels, landmarks, headings, live regions, and useful control names for screen readers. (Status is a polite live region, errors use alerts, and map controls have accessible names)
  - [x] Provide non-visual descriptions for hex position, neighbours, occupants, features, legal actions, dice, and results. (Board buttons expose coordinate, neighbours, recorded features, occupants, and legality; the event log and combat result strip expose rolls and outcomes as text.)
- [x] [P1] Ensure ownership, legality, status, and damage are never communicated by colour alone. (Map destinations and unit controls expose textual/ARIA legality and ownership state; event details remain textual)
  - [P1] Meet WCAG AA contrast and practical target-size requirements for gameplay controls.
- [x] [P1] Respect `prefers-reduced-motion` and provide equivalent immediate state feedback. (Global reduced-motion media query; state remains server-driven)
  - [P1] Keep animations interruptible, bounded, and synchronized with authoritative state.
- [x] [P1] Add first-match onboarding for the goal, setup order, four phases, board controls, and current decision. (A dismissible, locally persisted guide is available on first visit and through `How to play`; it describes setup, Move, Fight, Encounter, Deploy, and the current decision without modifying match state.)
  - [x] [P1] Add contextual explanations for why an action is unavailable. (The current-step panel explains waiting for acknowledgement, incomplete setup, spectator permissions, out-of-turn ownership, and completed-match state.)
  - [x] [P1] Add confirmation for destructive or irreversible choices without confirming routine safe actions excessively. (The optional persisted preference confirms monster disappearance only; routine movement, battle, encounter, and deployment choices remain unblocked.)
- [ ] [P1] Add sound categories for turn, dice, combat, cards, warnings, and victory using original/licensed audio.
  - [P1] Add master, music, effects, and mute controls persisted per browser.
- [x] [P1] Provide a complete no-audio experience and never rely on sound alone. (The current client has no audio dependency; every required action, roll, result, warning, and pending decision is rendered as text or an accessible label.)
  - [ ] [P1] Add settings for motion, volume, text/readability preferences, board labels, and confirmation behaviour. (Persisted Settings now cover manual reduced motion, larger text, board-label visibility, and disappearance confirmation; volume controls remain blocked until sound assets/effects are sourced.)

### Milestone 13 acceptance

- [ ] [P1] Complete keyboard-only and screen-reader playthroughs cover setup through victory.
- [ ] [P1] Automated accessibility checks and manual contrast, focus, zoom, reduced-motion, and touch-target reviews pass.
- [ ] [P1] Browser QA passes at agreed desktop, tablet, and mobile viewports with no hidden required controls.
- [x] [P1] Onboarding can be skipped, revisited, and completed without changing authoritative match state. (The guide persists only a browser-local seen flag, is reopened through `How to play`, and browser verification confirmed hide/reopen without changing match data.)

## Milestone 14 — Tests, playtesting, operations, security, deployment, and release

**Priority:** P0 for first-playable checks; P1 for public release  
**Depends on:** all release-scope milestones

- [ ] [P0] Expand unit tests for board validators, setup invariants, every phase transition, and deterministic randomness.
  - [P0] Add table-driven legal/illegal tests for movement, combat, encounters, deployment, and victory.
  - [x] Add API/store contract tests shared by memory and Prisma implementations. (`apps/api/src/store.contract.test.ts` runs the same board-pin, projection-redaction, stale-revision, and idempotent-retry assertions against both public store implementations.)
- [ ] [P0] Add end-to-end browser tests for local first playable and two-browser online play.
  - [x] Add fixed JSON contract fixtures for board keys, commands, events, errors, projections, and snapshots. (`contracts/development/*.json` is validated by `npm run contracts:verify` against the canonical development engine/API boundary; production board promotion remains source-gated.)
  - [x] [P0] Run catalogue verification, engine/API tests, typechecks, production builds, and Markdown/link checks in CI. (`.github/workflows/ci.yml` runs the consolidated `npm run verify` gate)
- [ ] [P0] Run structured internal playtests and capture rules defects, UX friction, incomplete states, and match duration.
  - [P0] Define first-playable exit criteria and produce an evidence checklist when it is reached.
  - [P1] Add isolated tests for every production Mutation and Research card.
- [x] [P1] Add property/invariant tests for inventory conservation, legal phase progression, single winner, and replay equivalence. (A 32-seed engine property fixture replays a complete development turn, checks inventory invariants after every command, and asserts byte-identical state and the expected next player.)
  - [x] Add fuzz tests for malformed commands, stale revisions, retries, and reconnect sequences. (Deterministic engine envelope fuzzing rejects malformed inputs without mutation; the API sequence test repeats reconnects, stale retries, and an idempotent accepted retry while preserving the snapshot.)
  - [ ] Add load tests for concurrent rooms, spectators, WebSockets, polling, persistence, and reconnect storms. (A bounded 24-room/48-spectator/read-reconnect regression now verifies Memory-store isolation and concurrency; WebSocket, polling, Prisma, and sustained-load benchmarking remain.)
- [ ] [P1] Add browser compatibility and responsive visual-regression coverage.
  - [x] [P1] Add a checked-in web accessibility source contract for landmarks, names, live regions, focus, reduced motion, touch targets, and overflow boundaries. (`npm run web-a11y:verify`; manual WCAG/assistive-technology review remains open.)
  - [x] Add logging with match/action correlation while redacting tokens and private game information. (HTTP command/setup/ready acceptance and request failures emit structured room/action/revision metadata without tokens or private state/card payloads.)
  - [x] Add metrics for command failures, latency, reconnects, room completion, abandonment, and server errors. (`ApiMetrics` records these counters and latency samples; `/metrics` exposes a token-free snapshot, while deterministic unit tests verify isolation and accumulation. External scraping/alert delivery remains deployment work.)
- [ ] [P1] Add error reporting and alerts for API health, persistence failures, event/snapshot divergence, and deployment regressions. (A local redacting error reporter now categorizes request/command/WebSocket failures, `/health` probes Prisma with `SELECT 1`, and bounded threshold alert log events are emitted; external alert routing and event/snapshot/divergence/deployment monitors remain.)
  - [x] [P1] Document the threat model for room codes, session tokens, command authorization, enumeration, replay, injection, rate abuse, and secret handling. (`docs/security-threat-model.md`; external production review remains open.)
  - [P1] Validate CORS, security headers, dependency risks, database permissions, backups, restore, and credential rotation.
- [ ] [P1] Choose hosting only after documenting requirements for static web delivery, WebSockets, durable API compute, Postgres, secrets, and observability.
  - [x] [P1] Document hosting requirements and environment separation before provider selection. (`docs/deployment-requirements.md`; no provider or live environment is claimed.)
  - [P1] Create staging and production environments with separate data, secrets, URLs, and deployment safeguards.
  - [x] [P1] Document database migration, rollback, backup/restore, and incompatible-match handling. (`docs/release-operations.md`; actual managed-Postgres drill remains open.)
- [ ] [P1] Verify production through real browser create/join/play/reconnect/spectate flows after deployment.
  - [P1] Complete final board-data, rules-fidelity, accessibility, content/IP, privacy, and security sign-offs.
  - [x] [P1] Prepare concise player rules, privacy information, known limitations, and release notes. (`docs/player-rules.md`, `docs/privacy.md`, `docs/known-limitations.md`, and `docs/release-notes.md`; public publication and support contact remain open.)
  - [P1] Publish a verified support route and public release documentation.

### Milestone 14 acceptance

- [ ] [P0] First-playable CI is green and a recorded two-player browser playtest reaches a valid winner.
- [ ] [P1] Full release CI, staging soak, production smoke test, backup/restore drill, and security checklist pass.
- [ ] [P1] Board audit, tests, build, deployed service health, and browser QA are reported as separate proof levels.
  - [x] [P1] Generate a deterministic report separating source/data, tests/build, deployed health, and browser evidence. (`npm run release-report:generate` writes `docs/release-proof-report.md`; deployment and source sign-off remain accurately marked unavailable/blocked.)
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

- [ ] [P0] Verified data for the fully filled honeycomb board required by the simplified ruleset is complete; the sparse nine-space topology cannot satisfy this checkpoint.
- [ ] [P0] Two players can set up, move, fight, encounter, deploy, and reach the temporary authoritative victory condition.
- [ ] [P0] Local and online play use the same deterministic rules engine and canonical board.
- [ ] [P0] Refresh/reconnect restores the match without duplicate or lost actions.
- [ ] [P0] Desktop and mobile browser playtests complete without developer intervention.
- [x] [P0] Known simplifications are visible in the UI and cannot be mistaken for full rule fidelity. (Persistent development-ruleset notice, source-gated setup copy, and board description identify the provisional fixture and omitted full-rules systems.)

### Full web v1

- [ ] [P1] All verified monster, unit, board, card, giant-unit, and Challenge rules are implemented.
- [ ] [P1] Two-, three-, and four-player matches can reach each valid victory type.
- [ ] [P1] Player and spectator projections preserve hidden information throughout live play, reconnect, and replay.
- [ ] [P1] Accessibility, responsive design, security, persistence, observability, and production deployment criteria pass.
- [ ] [P1] Original/licensed art, audio, naming, and wording are approved for release.
- [ ] [P1] The release has no unchecked P0 or P1 item unless it is explicitly removed from the versioned v1 scope with a recorded rationale.
