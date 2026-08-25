# Backend Hex-Grid Plan

## Status

This document is the implementation plan for replacing the current provisional map with a server-authoritative, rule-backed hex board.

The board photographs are reference material, not machine-readable truth. Coordinates, printed icons, barriers, labels, lairs and special spaces must be manually transcribed and checked against authoritative sources. Unknown details remain explicitly unresolved; they must not be inferred from decorative artwork.

## Outcome

The finished system will provide:

- one immutable, versioned board definition shared by the rules engine, API and clients;
- axial coordinates for platform-independent identity, neighbourhood and distance calculations;
- explicit topology for water barriers and exceptional connections;
- support for multiple monsters and military units in the same space;
- server-authoritative command validation, resolution and randomness;
- atomic snapshots and an append-only event log for retries, reconnection, replay and debugging;
- player-specific and spectator-safe state projections;
- deterministic, UI-free rules that work for web, iOS, tvOS and desktop clients;
- automated validation that prevents incomplete or internally inconsistent board data from shipping.

This is a backend and domain-data plan. It does not prescribe client artwork, camera position, animation, hex size or screen orientation.

## Current implementation and migration target

The current prototype has two separate map concepts:

- `apps/web/src/main.tsx` draws a decorative 12 by 19 offset grid and assigns water cells in client code.
- `packages/game-engine/src/index.ts` defines a small abstract set of locations using percentage `x`/`y` positions and manually authored `links`.

The API already has useful foundations:

- commands pass through the shared rules engine;
- rooms have a monotonically increasing `version`;
- Prisma commits the current JSON state and a game event in one transaction;
- optimistic concurrency prevents two commands from committing the same revision;
- action IDs provide partial retry protection;
- HTTP, WebSockets and polling support online players and spectators.

The migration will preserve those strengths while making the board definition canonical, moving all legal-map knowledge out of the web client, and expanding commands to model the actual Move, Fight, Encounter and Deploy steps.

## Design decisions

### 1. Canonical coordinates are axial

Every playable board space receives one stable axial coordinate:

```ts
export type HexCoord = Readonly<{
  q: number;
  r: number;
}>;

export type HexKey = `${number},${number}`;

export function hexKey({ q, r }: HexCoord): HexKey {
  return `${q},${r}`;
}

export function cubeS({ q, r }: HexCoord): number {
  return -q - r;
}
```

The six geometric directions are:

```ts
export const HEX_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const;
```

Axial coordinates are backend identity and rules data. Clients convert them to pixels or 3D world positions. An import or authoring tool may temporarily use row/column coordinates, but it must convert them at the data boundary; row offsets and pixels are not persisted in match state.

### 2. Geometry does not decide legal movement by itself

Axial neighbours describe physical proximity. They do not fully describe legal movement because the board contains water barriers, water classifications and potentially exceptional printed connections.

The board definition therefore stores explicit edges. Movement follows edges, never a raw `hexDistance <= move` test.

```ts
export type WaterBarrier = "none" | "lake" | "sea";

export interface BoardEdge {
  from: HexKey;
  to: HexKey;
  barrier: WaterBarrier;
  enabled: boolean;
  sourceRef: string;
}
```

Normal adjacent spaces receive explicit reciprocal edges during board authoring. Missing edges represent the board boundary or an impassable separation. If the physical board contains a genuinely one-way or exceptional connection, it is recorded deliberately and exempted from the reciprocal-edge validator.

### 3. Printed space features are composable

A board space can contain more than one printed icon, so it must not have one mutually exclusive `kind` value.

```ts
export type CityBenefit =
  | { kind: "health"; amount: 1 }
  | { kind: "health-roll"; dice: 1 | 2 | 3 };

export type SpaceFeature =
  | { kind: "city"; benefit: CityBenefit }
  | { kind: "military-base"; branch: Branch }
  | { kind: "infamy-site" }
  | { kind: "mutation-site"; siteId: string }
  | { kind: "challenge-site" }
  | { kind: "lair"; monsterId: string }
  | { kind: "hollywood" }
  | { kind: "los-angeles" };

export type WaterClass = "land" | "lake" | "sea" | "seacoast";

export interface BoardHex {
  key: HexKey;
  coord: HexCoord;
  label?: string;
  waterClass: WaterClass;
  features: readonly SpaceFeature[];
  sourceRefs: readonly string[];
  verification: "verified" | "unresolved";
  notes?: string;
}
```

`waterClass` describes the space. `BoardEdge.barrier` describes what must be crossed between spaces. Both are required to implement Lake, Sea and Sea/Seacoast Only movement correctly.

### 4. The board definition is static and versioned

Static map data is not copied into every match snapshot.

```ts
export interface BoardDefinition {
  id: string;
  version: number;
  name: string;
  rulesetVersion: string;
  contentHash: string;
  hexes: Readonly<Record<HexKey, BoardHex>>;
  edges: readonly BoardEdge[];
}
```

A match pins `boardId`, `boardVersion`, `rulesetVersion` and `contentHash` at creation. Published definitions are immutable. Corrections create a new version; an in-progress match continues using the version it started with.

For the first release, definitions should live as reviewed TypeScript or JSON data inside `packages/game-engine`, with a generated lookup index. They do not need database rows unless administrators must publish boards without deploying code.

### 5. Match state stores only changing state

Piece positions are the source of truth for occupancy. There is no singular `occupantId`, because any number of military units and, in applicable rule states, multiple monsters may share a space.

```ts
export type PiecePosition =
  | { kind: "board"; hex: HexKey }
  | { kind: "disappeared"; returnsOnTurn: number }
  | { kind: "record-tile" }
  | { kind: "trophy"; monsterId: string }
  | { kind: "removed" };

export interface PlayerState {
  id: string;
  seat: number;
  monsterId: string;
  militaryBranch: Branch;
}

export interface MonsterState {
  id: string;
  ownerId: string;
  position: PiecePosition;
  health: number;
  infamy: number;
  usedMutationSiteIds: readonly string[];
  mutations: readonly string[];
  movementAbilities: readonly MovementAbility[];
}

export interface MilitaryUnitState {
  id: string;
  branch: Branch | "National Guard";
  controlOverride?: {
    playerId: string;
    permissions: readonly ("move" | "fight" | "deploy")[];
    sourceEffectId: string;
  };
  position: PiecePosition;
  health?: number;
  movementAbilities: readonly MovementAbility[];
  giant: boolean;
}

export interface MovePhaseState {
  movedPieceIds: readonly string[];
  monsterMoveResolved: boolean;
}

export interface MatchState {
  schemaVersion: number;
  matchId: string;
  boardId: string;
  boardVersion: number;
  boardContentHash: string;
  rulesetVersion: string;
  revision: number;
  round: number;
  turn: number;
  activePlayerId: string;
  phase: "move" | "fight" | "encounter" | "deploy" | "challenge" | "game-over";
  players: Record<string, PlayerState>;
  monsters: Record<string, MonsterState>;
  militaryUnits: Record<string, MilitaryUnitState>;
  movePhase: MovePhaseState | null;
  stompedHexes: Record<HexKey, { monsterId: string; turn: number }>;
  pendingBattles: readonly PendingBattle[];
  decks: DeckState;
  challenge: ChallengeState | null;
  rng: ServerRngState;
}
```

Occupancy is derived with selectors such as `piecesAt(state, hexKey)`. A cached index may be built for performance, but it is not independently persisted and cannot drift from piece positions.

Each player is assigned exactly one monster and one military branch for the match. Ordinary military-unit control is derived from `PlayerState.militaryBranch`; it is not duplicated on every unit. `controlOverride` is reserved for a temporary or exceptional rule effect and names its exact permissions and source. National Guard units have no ordinary player mover and cannot be moved unless a specific implemented rule explicitly grants that permission.

Every physical military unit is created with a stable ID at setup, including units that begin on a branch record tile. Moving, deploying, taking a trophy and permanent removal change only that unit's `position`; they never replace it with an anonymous count. This allows the engine to account for the complete inventory of each branch at all times.

`movePhase` exists only during the Move step. It records every piece already moved and whether the active monster's movement decision has been resolved. A piece receives at most one complete movement path per Move step. Choosing not to move the monster still resolves its movement decision; choosing not to move an individual military unit requires no command.

Stomp state belongs to the hex, not to an individual feature. Encounter resolution applies all eligible printed features on an unstomped multi-icon space and then records the space as stomped.

## Board authoring and evidence

The first full board definition must be transcribed before full movement is implemented.

### Authoring workflow

1. Choose a documented axial orientation and assign a coordinate to every playable space.
2. Give every space its label, water classification and complete feature list.
3. Record every connection and classify every crossed water barrier.
4. Record all lairs, Los Angeles, Hollywood, military bases, cities, Mutation sites, Infamy sites and Challenge sites.
5. Attach a source reference to each non-obvious fact. A source reference identifies the image/document and, where possible, an annotated region.
6. Mark indistinct or contradictory details as `unresolved`; do not invent a value.
7. Review the transcription against at least one clean board reference and the higher-resolution setup photograph where necessary.
8. Promote the definition to playable only when the validator reports no unresolved rule-affecting fields.

### Required validators

The board-validation command must fail when:

- a key does not equal the canonical key for its coordinate;
- coordinates or keys are duplicated;
- an edge references a missing hex;
- a normal edge lacks its reciprocal edge;
- an edge joins non-neighbouring coordinates without an explicit exception reason;
- a barrier has an invalid water classification;
- a feature requires an ID or branch and it is missing;
- a monster does not have its required lair data;
- required special spaces are absent;
- a `sourceRef` is missing for rule-bearing data;
- a production board contains an unresolved rule-bearing field;
- a static definition contains match state such as pieces or stomp markers;
- the content hash differs from the generated manifest.

The validator should also report, without automatically inventing corrections:

- disconnected regions;
- isolated spaces;
- suspiciously duplicated labels or site IDs;
- spaces reachable only through a disabled edge;
- feature and marker counts for manual comparison with the physical board.

Match setup validation, kept separate from static board validation, must also reject:

- a player without exactly one assigned monster and one assigned military branch;
- a monster or military branch assigned to more than one player;
- a `MonsterState.ownerId` that disagrees with the corresponding player assignment;
- a military unit whose branch is unknown to the ruleset;
- duplicate or missing unit IDs in a branch's required inventory;
- a control override that references a missing player, an invalid permission or an unsupported source effect;
- a moved-piece ledger containing a missing, ineligible or duplicated piece ID.

## Movement model

### Path-based commands

The client sends an intended path, not a changed position and not merely a destination. A path is necessary when two routes to the same destination differ in barriers, occupied spaces or stop conditions.

```ts
export interface MovePieceCommand {
  type: "MOVE_PIECE";
  pieceId: string;
  path: readonly HexKey[];
}
```

The first path element is the piece's current hex and the last is its requested destination. A zero-space move is represented by omitting a move for that piece and eventually sending `END_MOVE`; it does not need a self-edge.

Each accepted `MOVE_PIECE` command moves exactly one piece along its complete path. The active player may submit these commands separately, in any legal order, for their monster and any number of eligible units from their assigned military branch. The engine updates `movePhase.movedPieceIds` after each command so a piece cannot receive a second movement allowance during the same turn.

### Movement validation order

For each `MOVE_PIECE`, the engine must:

1. Confirm the match is active and in the Move step.
2. Resolve the actor's `PlayerState` and confirm they are the active player.
3. Confirm a monster is the player's assigned `monsterId`, or a military unit belongs to the player's assigned `militaryBranch` or has an applicable control override.
4. Reject normal movement of National Guard units.
5. Confirm the piece is on the board, is eligible to move and is not already present in `movePhase.movedPieceIds`.
6. Confirm the first path coordinate matches the authoritative position.
7. Confirm every path step exists and follows an enabled board edge.
8. Confirm path length does not exceed the piece's effective Move value.
9. Apply water and Sea/Seacoast Only restrictions to every step.
10. Apply Fly and any card/record-tile overrides.
11. Apply pass-through and mandatory-stop rules using occupancy at each step.
12. Apply pre-Challenge restrictions on monsters sharing or passing through spaces.
13. Reject a path that continues after a mandatory stop.
14. Record the accepted move, mark the piece as moved and create any compulsory pending battles.

Movement queries should expose `legalDestinations` and, where useful, legal paths for UI highlighting. They are advice based on a specific revision; the command is still revalidated when submitted.

### Rule-specific movement requirements

- A monster moves zero to its printed Move and stops on entering any military unit's space.
- The active player may move only their assigned monster and units from their assigned military branch.
- The monster and each eligible branch unit are separate movement decisions and may each receive no more than one movement path during the Move step.
- The active player may move any number of their eligible branch units, including none; units omitted before `END_MOVE` remain in place.
- Before the Challenge, a non-flying monster cannot enter or pass through another monster's space.
- A military unit stops on entering any monster's space.
- Military units may pass through other military units.
- Any number of military units may share a hex.
- National Guard units cannot normally move, even when the active player deployed them.
- A temporary controller override changes only the decisions explicitly granted by that rule; it does not change the unit's branch or permanent ownership.
- Fly ignores water barriers and pass-through stops but does not automatically permit an illegal final space.
- Lake crosses only qualifying inland-water barriers.
- Sea crosses qualifying sea barriers.
- Sea/Seacoast Only requires the origin, destination and every intervening space to have a permitted water class.
- Disappearing and returning from a lair are dedicated commands/state transitions, not synthetic hex edges.
- Hollywood restrictions and Los Angeles/lair fallback are validated by the engine.

## Commands, events and phase progression

Replace the prototype's broad `move` and `advance` commands with explicit intentions:

```ts
export type GameCommand =
  | MovePieceCommand
  | { type: "DISAPPEAR_MONSTER"; monsterId: string }
  | { type: "RETURN_MONSTER"; monsterId: string; destination: HexKey }
  | { type: "END_MOVE" }
  | { type: "CHOOSE_BATTLE"; battleId: string }
  | { type: "CHOOSE_ATTACK"; attackerId: string; targetId: string; spendInfamy?: number }
  | { type: "CHOOSE_RETREAT"; pieceId: string; destination: HexKey }
  | { type: "RESOLVE_ENCOUNTER" }
  | { type: "DEPLOY_UNIT"; unitId: string; destination: HexKey }
  | { type: "REDEPLOY_UNIT"; unitId: string; destination: HexKey }
  | { type: "DRAW_RESEARCH" }
  | { type: "END_DEPLOY" }
  | ChallengeCommand;
```

Only add commands when their rules are implemented. Unsupported actions must return a typed `RULE_NOT_IMPLEMENTED` error rather than silently approximating them.

One accepted command increments the match revision once and may emit several domain events. Events describe facts that occurred, for example:

- `piece.moved`;
- `monster.disappeared`;
- `battle.created`;
- `combat.attack-resolved`;
- `space.stomped`;
- `city.health-gained`;
- `infamy.gained`;
- `mutation.drawn`;
- `unit.deployed`;
- `challenge.declared`.

Phase changes are engine results, not client requests to mutate phase directly. `END_MOVE` is valid only when every required movement decision is complete; Fight, Encounter and Deploy then enforce their own pending decisions.

For `END_MOVE`, omitted military units are treated as choosing zero movement. If the active monster has not moved or disappeared, `END_MOVE` records its zero-space movement decision before closing the step. Returning a disappeared monster or using `DISAPPEAR_MONSTER` also sets `monsterMoveResolved` and consumes that monster's entire movement decision.

## Authoritative command envelope

Every online command uses a transport envelope separate from the domain command:

```ts
export interface CommandEnvelope {
  commandId: string;
  matchId: string;
  expectedRevision: number;
  command: GameCommand;
}
```

The API processing order is:

1. Authenticate the room token.
2. Resolve the participant and authoritative player ID.
3. Reject spectators and actors without permission to issue that command.
4. Validate `matchId`, room status and `expectedRevision`.
5. Check `(matchId, commandId)` for an earlier result and return that result for retries.
6. Load the pinned board and ruleset versions.
7. Apply the command through the UI-free engine.
8. Resolve randomness on the server.
9. Persist the new snapshot, revision, command receipt and domain events atomically.
10. Return the actor's projected view and broadcast new projected views.

A stale revision returns a typed `REVISION_CONFLICT` response containing the current revision and a resync instruction. It must not be presented as an ordinary illegal move.

## Persistence

Keep the current room snapshot approach and strengthen the event model.

### Proposed Prisma-level shape

```text
GameRoom
  id
  code
  status
  version
  boardId
  boardVersion
  boardContentHash
  rulesetVersion
  state                 JSONB, current server snapshot
  createdAt
  updatedAt

GameCommandReceipt
  id
  roomId
  commandId
  actorId
  expectedRevision
  committedRevision
  command               JSONB
  resultSummary         JSONB
  createdAt
  UNIQUE(roomId, commandId)

GameEvent
  id
  roomId
  revision
  sequence
  actorId
  type
  publicPayload         JSONB
  privatePayload        JSONB nullable, server only
  createdAt
  UNIQUE(roomId, revision, sequence)

GameSnapshot            optional historical checkpoints
  roomId
  revision
  state                 JSONB
  createdAt
  UNIQUE(roomId, revision)
```

The `GameRoom.state` row remains the latest snapshot for quick reads. `GameEvent` is append-only. Historical `GameSnapshot` rows can be added every fixed number of revisions if replay speed requires them; they are not necessary for the first migration.

`commandId` must be a dedicated indexed column, not only nested inside an event payload. A single command may generate multiple events, so command idempotency and event identity are separate concerns.

### Atomic commit

Within one database transaction:

1. Insert or reserve the unique command receipt.
2. Conditionally update `GameRoom` where `version = expectedRevision`.
3. Write every event with deterministic sequence numbers.
4. Finalise the receipt with the committed revision and result summary.
5. Optionally write a periodic historical snapshot.

If the conditional update affects no row, roll back and return `REVISION_CONFLICT`. If the unique command receipt already exists, return its committed result without applying the command again.

## Determinism and randomness

The engine must not call `Math.random()`, `Date.now()` or generate IDs internally.

```ts
export interface EngineContext {
  now: string;
  idFactory: () => string;
  rng: RulesRng;
  board: BoardDefinition;
  ruleset: RulesetDefinition;
}
```

Online games receive this context from the server. Local pass-and-play supplies an in-memory equivalent.

The server stores protected PRNG state or derives randomness from a secret match seed and counter. Every resolved die or draw outcome is recorded in the resulting event so a replay does not reroll. Secret deck order and RNG state stay out of player and spectator views.

Deterministic replay tests must prove that the initial snapshot plus the same accepted commands and recorded outcomes produces the same final public state.

## State projection and transport

The canonical server state is not automatically the API response.

```ts
projectMatch(state, viewer): PlayerMatchView | SpectatorMatchView
```

Projection must remove:

- RNG seed/state;
- undrawn deck order;
- private command metadata or future hidden rules data;
- authentication tokens and token hashes;
- any player-only information not legally visible to the viewer.

WebSocket broadcasts must be generated per viewer role rather than broadcasting one unfiltered room object. Events also need public/private projections; an event log must not leak hidden draw order or server randomness.

HTTP remains authoritative for command submission. WebSockets announce accepted revisions and projected updates. Polling remains a reconnection fallback. On reconnect, a client supplies its last revision and receives either missing projected events or a fresh projected snapshot when the gap is too large or incompatible.

## Package boundaries

Recommended package structure:

```text
packages/game-engine/src/
  board/
    coordinates.ts       axial maths and canonical keys
    definition.ts        board-domain types
    board-v1.ts          manually authored board definition
    validate.ts          definition validation
    selectors.ts         neighbours, features and occupancy
  movement/
    paths.ts             reachable paths and path validation
    abilities.ts         Fly, Lake, Sea and Sea/Seacoast Only
    stop-rules.ts        occupancy and Challenge restrictions
  rules/
    commands.ts
    reducer.ts
    move.ts
    fight.ts
    encounter.ts
    deploy.ts
    challenge.ts
  projection/
    player-view.ts
    spectator-view.ts
  state/
    schema.ts
    migrations.ts
```

`packages/shared` owns transport envelopes, projected response types and typed API errors. It must not redefine engine commands independently; use a single exported command contract to prevent the existing duplicated `GameCommand` definitions from drifting.

`apps/api` owns authentication, concurrency, persistence, server RNG, command receipts and transport projection.

Clients own only coordinate-to-screen conversion, selection, animation, accessibility and input. They may call pure engine query helpers for previews during local play, but online server responses remain final.

## Error contract

Return stable error codes with human-readable messages:

```ts
export type GameErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "MATCH_NOT_ACTIVE"
  | "REVISION_CONFLICT"
  | "UNKNOWN_BOARD_VERSION"
  | "INVALID_COMMAND"
  | "WRONG_PHASE"
  | "NOT_YOUR_TURN"
  | "PIECE_NOT_CONTROLLED"
  | "INVALID_PATH"
  | "MOVEMENT_EXCEEDED"
  | "WATER_BARRIER"
  | "MANDATORY_STOP"
  | "SPACE_OCCUPIED"
  | "RULE_NOT_IMPLEMENTED";
```

Logs may include internal diagnostics, but responses must not reveal hidden state.

## Testing strategy

### Coordinate and board-definition tests

- canonical key round-trips;
- six unique neighbours for an interior coordinate;
- symmetry and triangle properties for hex distance;
- board validator catches duplicate coordinates, missing spaces and bad edges;
- expected counts of verified spaces, features, barriers and lairs;
- every production edge and feature has evidence metadata;
- a checked-in content hash changes whenever the board definition changes.

### Movement tests

- every player is mapped to exactly one monster and one military branch;
- a player cannot move another player's monster or branch unit;
- the active player can move their monster and several branch units through separate commands;
- moving one piece does not move or overwrite any other piece;
- a piece cannot be moved twice during one Move step;
- units omitted before `END_MOVE` remain in their existing positions;
- `END_MOVE` records a zero-space monster choice when the monster was omitted;
- National Guard units reject normal movement commands;
- a valid temporary control override grants only its specified decisions;
- record-tile, board, trophy and removed positions preserve the full branch inventory;
- zero-to-Move path lengths;
- non-adjacent path steps are rejected;
- land movement cannot cross water barriers;
- Lake and Sea abilities cross only their permitted barriers;
- Sea/Seacoast Only validates every path space;
- Fly ignores pass-through and barrier restrictions but respects final-space restrictions;
- monsters and military units stop on the required opposing piece category;
- military units can traverse and stack with other units;
- pre-Challenge and post-Challenge monster occupancy rules differ correctly;
- alternate paths to the same destination are evaluated independently;
- disappearing, lair return, Hollywood and Los Angeles fallback rules.

### Encounter and board-state tests

- multiple printed features resolve from one space;
- city benefits use the printed category and cap Health at 40;
- a base awards Infamy/trophy and blocks later deployment after stomping;
- Infamy sites cap monster Infamy at 15;
- Mutation sites are tracked per monster and per site;
- Challenge sites are inert before declaration and active afterward;
- stomped spaces cannot be stomped or rewarded twice;
- multiple monsters and units can be indexed at one coordinate without data loss.

### Server and persistence tests

- actor identity, ownership, turn and phase are checked server-side;
- spectators cannot submit commands;
- stale revisions return `REVISION_CONFLICT`;
- concurrent commands allow exactly one commit for a revision;
- retrying a command ID returns the previous result without duplicate events;
- a multi-event command commits snapshot, receipt and all events atomically;
- rollback leaves no partial command receipt or event;
- reconnection from a known revision receives the correct delta;
- snapshot replay reaches the same state;
- player and spectator projections do not expose server-only state.

### Cross-platform contract tests

Export fixed JSON fixtures containing board coordinates, legal paths, accepted commands, errors and projected states. Web and future native clients must decode these fixtures and map the same `HexKey` values to their chosen presentation without changing game meaning.

## Implementation sequence

### Phase 0: Freeze and audit the source data

- Preserve the current abstract prototype as a separate development fixture.
- Create the axial orientation convention and board-authoring template.
- Transcribe the complete board with source references and unresolved flags.
- Produce an annotated review image or coordinate table for human checking.
- Do not claim board accuracy until every rule-bearing space and barrier is verified.

**Exit criteria:** the board validator passes structural checks; the remaining unresolved inventory is explicit and reviewed.

### Phase 1: Add board primitives without changing gameplay

- Add coordinate, key, board, feature and edge types.
- Add neighbour, distance, edge lookup and validation utilities.
- Add the provisional map as a versioned development board definition.
- Add unit tests and a board-validation script.

**Exit criteria:** typecheck and tests pass; both server and web can import the same read-only board definition.

### Phase 2: Migrate engine positions and state

- Replace location strings tied to `locations[]` with `HexKey` board positions.
- Add discriminated off-board positions.
- Add `PlayerState` with one stable monster assignment and one stable military-branch assignment per player.
- Give every monster and physical military unit a stable ID at match setup, including record-tile units.
- Derive ordinary military-unit control from branch ownership and reserve controller overrides for explicit special rules.
- Remove percentage `x`/`y` and gameplay `links` from the rules state.
- Add derived occupancy selectors and stomped-hex state.
- Pin board/ruleset versions in new matches.
- Add an explicit state schema version and migration guard.

Existing prototype rooms may be discarded in development or migrated through an explicit one-time mapping. Never silently interpret an old location ID as a hex key.

**Exit criteria:** engine state contains no presentation coordinates, accounts for every branch unit, maps every player to exactly one monster and branch, and supports multiple pieces per hex.

### Phase 3: Implement full movement topology

- Implement path validation over explicit edges.
- Add water classes, barriers and movement abilities.
- Add occupancy stop rules and Challenge-dependent restrictions.
- Add `MOVE_PIECE`, disappear/return and `END_MOVE` commands.
- Add `MovePhaseState`, track pieces moved during the current turn, prevent duplicate movement and build pending battles.
- Prove that the active player's monster and eligible branch units can be moved separately without changing unselected pieces.

**Exit criteria:** the movement matrix passes for monsters, all military categories and special movement abilities.

### Phase 4: Complete board-aware encounters and deployment

- Resolve all features on a space in rules order.
- Implement per-space stomp state and benefits.
- Implement per-monster Mutation-site history.
- Enforce base ownership, stomped-base restrictions, National Guard destinations and deployment limits.
- Integrate Challenge sites and later the complete Challenge flow.

**Exit criteria:** feature, stomp, mutation and deployment tests pass against verified board fixtures.

### Phase 5: Harden commands and persistence

- Add `expectedRevision` to the command envelope.
- Add dedicated command receipts and event sequence numbers.
- Remove command-ID lookup through JSON payloads.
- Remove `Math.random()` and `Date.now()` from engine transitions.
- Add typed errors, deterministic engine context and replay tests.
- Add schema/state migration handling and board-version pinning.

**Exit criteria:** concurrency, idempotency, atomicity and deterministic replay tests pass for memory and Prisma stores.

### Phase 6: Add safe projections and reconnect flow

- Split canonical state from player and spectator views.
- Project WebSocket messages per connection.
- Add event delta and snapshot fallback responses.
- Confirm browser-session restoration at old, current and stale revisions.

**Exit criteria:** no projection fixture contains RNG/deck secrets; reconnection and spectator tests pass.

### Phase 7: Replace the client-only grid

- Render the web board entirely from `BoardDefinition` coordinates and features.
- Keep pixel placement, orientation, camera and animation in the client.
- Remove the hard-coded 12 by 19 `waterEdge` grid from `apps/web/src/main.tsx`.
- Send paths and command envelopes rather than locally altered state.
- Apply the same contract to future iOS, tvOS and desktop clients.

**Exit criteria:** the web client has no independent board topology or rule-bearing marker inventory, and local/online play use the same board definition.

## Delivery checkpoints

Each phase should report these proof levels separately:

- board-data audit status and unresolved items;
- unit and integration tests;
- TypeScript typecheck;
- production build;
- memory-store verification;
- Prisma/Postgres verification;
- browser interaction verification;
- native-client verification when those clients exist.

A passing build does not prove that the reconstructed board is accurate. Board accuracy requires a completed source audit and human review of the authored coordinate/feature/edge inventory.

## Definition of done

The backend hex grid is complete when:

- a verified versioned board definition contains every playable space, printed rule feature and water barrier;
- no client owns an independent copy of board topology;
- legal movement is derived from explicit edges, abilities, occupancy and current Challenge state;
- all pieces use stable hex or explicit off-board positions and multiple pieces can share a hex;
- every player has one explicit monster and military-branch assignment, and every physical branch unit remains individually accounted for;
- a Move step can move the active player's monster and any number of eligible branch units separately, at most once each, while omitted pieces remain in place;
- all board encounters and deployment rules operate on composable space features and dynamic stomp state;
- every accepted command is authenticated, revision-checked, idempotent and atomically persisted;
- randomness is server-controlled and replayable from recorded outcomes;
- player and spectator views reveal only permitted state;
- reconnect and replay work from persisted revisions;
- the rules engine remains deterministic and free of UI/platform dependencies;
- validation, engine, API, persistence and contract test suites pass;
- the board-data audit has no unresolved rule-bearing items.
