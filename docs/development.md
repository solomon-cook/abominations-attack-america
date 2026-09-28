# Developer guide

This guide describes the current code boundaries and the commands used to make a change reviewable. The project is an npm workspace; run root scripts from the repository root.

The coordinated site/game overhaul sequence and its current evidence status are tracked in the [staged overhaul plan](overhaul-plan.md). Code-quality and module-boundary findings are tracked in the [maintainability audit ledger](maintainability-audit.md). The API findings and follow-ups are tracked in the [backend audit ledger](backend-audit.md). The UI work is tracked in the [frontend surface audit ledger](ui-surface-audit.md), which distinguishes covered flows from open browser and manual review.

## Code map

| Path | Responsibility |
| --- | --- |
| `apps/web` | React/Vite browser client, user interaction, and rendering |
| `apps/api` | HTTP and WebSocket room service, accounts, persistence adapters, and operational endpoints |
| `packages/game-engine` | Platform-independent game state, setup, rules, bots, and board/card/unit definitions |
| `packages/shared` | Types shared by the web client and API, including room projections and wire messages |
| `scripts` | Focused verification, evidence generation, and build-support scripts |
| `docs` | Architecture contracts, source-status records, product plans, and release evidence |

### Runtime path map

- **Browser entry and interaction:** `apps/web/src/main.tsx` mounts Home, setup, and the active match, and owns the top-level phase and room view state. `apps/web/src/components/` contains the game shell's UI families: setup/lobby/account, board and map controls, status/record sheets, action and movement controls, phase choices, and terminal screens. `BoardReview.tsx` is a separately loaded in-app inspection screen selected by state in `main.tsx`, not a URL route.
- **Browser transport:** `apps/web/src/api.ts` owns HTTP/WebSocket room calls. `connection-lease.ts` sequences and persists client connection IDs across lease requests; `command-ack.ts` correlates accepted commands with later room revisions. `main.tsx` connects room projections to those transport helpers and the UI.
- **Service boundary and room state:** `apps/api/src/server.ts` parses HTTP and WebSocket requests and dispatches them to the store. `session.ts`, `rate-limit.ts`, and `runtime-config.ts` hold session, throttling, and environment boundaries. `store.ts` implements in-memory rooms; `prisma-store.ts` implements the persistent adapter. Both apply commands in the game engine and produce audience-specific projections.
- **Game model and bots:** `packages/game-engine/src/index.ts` defines canonical game state, command application, legality, resolution, migrations, and projections. Setup sequencing is in `setup.ts`; shared board geometry and definitions are in `board.ts` and `audited-board.ts`/`audited-board-data.ts`; catalogs and effects are in `monsters.ts`, `units.ts`, `cards.ts`, and `effects.ts`; bot policy is in `bots.ts`. Local solo bot turns are orchestrated from `apps/web/src/main.tsx`. Disconnected-seat takeover invokes the same engine policy through `processBotTakeovers` in each store; the API runs that worker every five seconds, while eligibility starts after four minutes disconnected. `packages/shared/src/index.ts` defines transport and room-view types while reusing the engine command contract.
- **Evidence seams:** engine behavior is covered by `packages/game-engine/src/*.test.ts`; API routes and store contracts by `apps/api/src/*.test.ts`; browser journeys and source/render contracts by `scripts/verify-*.mjs` and `scripts/verify-*.ts(x)`. The focused commands below name the common entry points, but the [overhaul plan](overhaul-plan.md) and [UI surface ledger](ui-surface-audit.md) track the broader, still-partial coverage.

The web client sends versioned commands to the API. The game engine owns the canonical `GameCommand` and `GameCommandEnvelope` contracts; `packages/shared` defines room projections and transport messages and re-exports `GameCommand` rather than maintaining a second, narrower union. The API checks room access and command ownership, then applies commands through the shared game engine and returns a player- or spectator-specific projection. The API can use an in-memory store for local play or Prisma/Postgres for persistence. `apps/api/src/server.ts` is the HTTP/WebSocket entry point; `apps/api/src/store.ts` and `apps/api/src/prisma-store.ts` implement the memory and database stores.

For the current HTTP and WebSocket route surface, token rules, room revisions, and persistence boundaries, see the [API reference](api-reference.md).

### API request and event paths

- **HTTP:** `apps/api/src/server.ts` runs the process-local remote-address limiter, matches an exact route, validates unsafe account-request origins before parsing their bodies, parses JSON (with the 64 KiB cap), applies session/token and role checks, then calls the `RoomStore` operation. The store checks room lifecycle, leases, actor/decision and revision; accepted commands pass through `applyCommandEnvelope`/`applyCommand`. The selected store persists or updates the resulting snapshot/event/receipt, projects the room for the player or spectator, and `server.ts` writes the response. Error classification and reporting also live at this boundary.
- **WebSocket:** the browser obtains a one-use ticket through `POST /rooms/:code/ws-ticket`, then connects to `/ws`. `server.ts` rate-limits all upgrade attempts before origin validation, then rate-limits accepted connections, consumes the ticket through the store, activates the participant lease, and sends a private projection. Each text command is rate-limited and envelope-validated before store submission. The acknowledgement carries only action ID and revision; a queued broadcast reloads each connected participant's projection through the lease-checked store path. The server sends heartbeats every 30 seconds and revokes stale local sockets when it observes a replaced lease. The [API reference](api-reference.md) records cross-process delivery and idle-socket limits.
- **Disconnected seats:** every five seconds the API calls `processBotTakeovers` on the selected store. After four minutes disconnected, eligible seats can be marked bot-controlled; setup and command choices use `packages/game-engine/src/bots.ts` and accepted actions follow the same store commit/event/broadcast path. Memory and Prisma implementations share this behavior but have different persistence/concurrency boundaries documented in the [backend audit ledger](backend-audit.md).

## Local development

Use Node.js 22, matching CI, and install the locked workspace dependencies:

```sh
npm ci
```

Start the web client and API in separate terminals from the repository root:

```sh
npm run dev
npm run dev:api
```

The browser client defaults to `http://localhost:8787`. Without a database URL, the API uses an in-memory store; data is lost when the process stops, account routes and public player profiles return 503, and the leaderboard returns an empty list. `PERSISTENCE=memory` forces this in-memory behavior even when a database URL is configured. Durable rooms and account features require a configured Postgres database and Prisma migrations. Database setup and environment requirements are described in the [README](../README.md) and [deployment requirements](deployment-requirements.md). Do not use the placeholder values in `.env.example` as live credentials or endpoints.

## Change boundaries

- Keep game rules and bot decisions in `packages/game-engine`; UI components should present legal choices and submit commands rather than independently resolving rules.
- Update shared wire or projection types in `packages/shared` when the browser/API contract changes, and preserve the player/spectator privacy boundary.
- Treat persisted game snapshots as a compatibility contract. Follow the [state migration policy](state-migration.md) when fields or interpretation change, and keep the board/ruleset pins meaningful.
- Keep room status, reconnect, and session behavior aligned across the memory and Prisma stores; see the [room lifecycle contract](room-lifecycle.md) and [persistence contract](persistence-contract.md).
- Treat the physical edition as the authority for rule-bearing decisions. Transcription or implementation evidence does not replace physical-source review; source approval remains a manual release gate. See [known limitations](known-limitations.md) for current release boundaries.

## Validation commands

Run the narrowest checks relevant to the change, then run the full CI gate before proposing a release:

| Change area | Focused command |
| --- | --- |
| Game engine behavior | `npm --workspace @abominations/game-engine test` |
| API behavior and store contracts | `npm --workspace @abominations/api test` |
| Web or API TypeScript | `npm run typecheck:web` or `npm run typecheck:api` |
| Web production bundle | `npm run build` |
| API production bundle | `npm run build:api` |
| Pruned API runtime bundle with sequential PGlite HTTP probe (Node 24; isolated scratch install) | `npm run api:production-package:pglite:verify` |
| Home entry flow and responsive disclosures (mocked API fixture) | `npm run browser:home:verify` |
| Home account/profile browser flow (mocked API fixture) | `npm run browser:account:verify` |
| Production PWA update prompt, worker activation, and offline fallback | `npm run pwa:browser:verify` |
| Local game browser flow and desktop/tablet/phone matrix | `npm run browser:local:verify` and `npm run browser:local:matrix` |
| Keyboard navigation/settings and accessible game controls | `npm run browser:keyboard:verify` |
| Multi-session online room/API smoke (local in-memory API by default) | `npm run browser:online:verify` |
| Deterministic two-player online Fight entry and resolution (local in-memory API) | `npm run browser:online:fight:verify` |
| Encounter dialog focus, fallback, and ownership lifecycle (component fixture) | `npm run browser:encounter:focus:verify` |
| Cutbacks Research-card action and projection privacy (component fixture) | `npm run browser:cutbacks:verify` |
| Challenge arena opponent selection (component fixture) | `npm run browser:challenge:arena:verify` |
| Challenge Mutation card actions, keyboard flow, and waiting-role suppression (component fixture) | `npm run browser:challenge:mutations:verify` |
| Modal Monster Sheet Berserk action (component fixture) | `npm run browser:monster-sheet:mutation:verify` |
| Deploy/redeploy Cancel placement (component fixture) | `npm run browser:deployment-cancel:verify` |
| Bounded all-bot 3/4-seat strategy and route-scoring sample | `npm run verify:bot-strategy:batch -- --seed-count=1 --max-rounds=1` |
| Paired bot tactic screens and Research-draw decision probe | `npm run verify:bot-policy:paired` (use `-- --pair-count=7 --max-rounds=12` for the terminal screen) and `npm run verify:bot-policy:research-probe` |
| Local victory scenario (local Vite plus in-memory API by default) | `npm run browser:victory:verify` |
| Board review page and 336-cell inspection | `npm run browser:board-review:verify` |
| Throttled production-preview performance baseline (build first; writes raw JSON) | `npm run build` then `npm run browser:performance:measure -- --runs=7 --output=output/performance/browser-benchmark.json` |
| Local Markdown links | `npm run docs:verify` |
| Full repository gate used by CI | `npm run verify` |

The local and board-review browser checks run against a local Vite development server. The online and victory checks start a local memory-backed API unless `BROWSER_API_URL` is supplied; all may target an existing browser server through `BROWSER_TEST_URL`. The account browser check intercepts requests with explicit fixtures and does not establish real-service persistence or mail delivery. Focused UI component fixtures exercise specific branches only; the [UI surface ledger](ui-surface-audit.md) records remaining states and evidence limits. The bot-strategy harness defaults to 12 seeds for each of three and four seats, up to 12 rounds and 2,000 actions per match; use smaller explicit caps for a quick smoke sample. The three-round paired tactic screen and Research probe verify selector/action paths, not competitive quality. The optional 12-round paired terminal screen runs 14 matches and took about 14 minutes in the recorded environment; its seven pairs are execution evidence only, with one discordant focal outcome and no Research draws. These checks are local acceptance evidence, not deployed-service sign-off.

`npm run docs:verify` checks that relative Markdown links resolve. It does not check factual accuracy, spelling, formatting conventions, or whether a source claim has been manually approved. The CI workflow also runs browser smoke and keyboard jobs; these are separate from the root `verify` script. See [supported browser targets](browser-support.md) for their current scope and remaining manual reviews.

`npm run verify` typechecks the API and builds its runtime bundle, as well as building the web app. It does not run the isolated clean-install/prune/PGlite acceptance; run `npm run api:production-package:pglite:verify` when changing or reviewing the API runtime package. The scratch proof requires Node 24 and network access for `npm ci`.

When changing a persisted-state format, API contract, room lifecycle, source-sensitive rule, or user-facing interaction, update its contract/evidence document alongside the implementation so reviewers can check the intent and the proof separately.
