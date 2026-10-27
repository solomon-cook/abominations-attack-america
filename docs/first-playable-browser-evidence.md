# First-playable browser evidence

This checklist records browser evidence separately from engine, build, and source-data verification. It is currently an evidence-in-progress artifact for the human-audited MVP board, not a full-rules release sign-off. The development fixture is not the MVP board: first-playable acceptance uses the fully filled 336-cell audited honeycomb.

New local and online MVP matches use `createMvpRoomGame` with the pinned `AUDITED_BOARD`; both Memory and Prisma room stores use that constructor unless a test explicitly opts into `allowDevelopmentFixture`. The separately versioned provisional board remains available for explicit playtests and old pinned saves. The audited board passes strict production board validation; independent release review, the full-rules scope, and complete browser acceptance remain open.

## Exit criteria

A first-playable browser pass is complete only when a clean supported browser session can, without developer tools:

1. complete the ordered two-player setup;
2. make a legal move, preview and cancel a path, confirm a path, and reject or recover from an illegal/stale action;
3. resolve Fight, Encounter, and Deploy decisions through visible controls;
4. refresh or reconnect without losing the pending decision;
5. reach the temporary authoritative victory condition and show the same winner after refresh;
6. repeat the flow in an online two-browser session; and
7. repeat the required interaction checks at the supported mobile viewport.

## Exit-evidence checklist

The first-playable claim is allowed only when every row has current evidence at the
scope shown below. A green build, engine test, or development-fixture smoke cannot
substitute for a browser, source-data, or production proof row.

| Requirement | Required proof | Current status |
| --- | --- | --- |
| Authoritative board | Reviewed full-board transcription, stable IDs/coordinates, water and edge data, validation output, and human sign-off | Verified: 336-cell audit source, strict production validation, and user-authorized human data sign-off; independent review remains open |
| Shared match board | Engine, API, and browser record the same board ID and content hash; production room creation pins the audited board | Engine/API fixtures pin `AUDITED_BOARD`; the latest 7/7 local Chrome matrix confirms the browser board ID and rendered hash match; online persistence identity remains separate |
| Two-player setup and turn loop | Clean supported-browser run covers setup, Move, Fight, Encounter, Deploy, cancellation, invalid/stale recovery, and victory | Partial: 7/7 local viewports cover setup, camera interactions, movement, encounter, and deployment. The 2026-10-07 three-session online run completes setup and its opening turn through the browser UI, then drives both authenticated seats through legal API commands to a real audited-board Monster Challenge victory while player and spectator browsers observe the same terminal result. Human completion of the full route, UI control coverage for every later decision, and every cancellation remain open |
| Refresh and reconnect | Browser evidence shows the pending decision and terminal result survive refresh/disconnect/reconnect without duplicate actions | Partial: the 2026-10-07 audited-board three-session harness verifies browser-process reconnect, reload recovery, and terminal reload with the memory API; durable production persistence remains open |
| Two-browser online play | Two independent supported-browser sessions complete a match and observe the same revisions, decisions, and winner | Partial: the 2026-10-07 run verifies audited-board room creation, two-player join, spectator projection, setup, synchronized movement, Fight, Encounter, Deploy, reconnection, and terminal recovery after a bot-driven Monster Challenge victory. The remaining gap is a human playthrough of the complete route and deployed-browser acceptance |
| Mobile interaction | The same required decisions complete at each supported mobile viewport with no hidden required controls or overflow | Partial: the 8 October 2026 audited-board Chrome run passes at 320×740, 390×844, and 844×390; manual device and accessibility acceptance remain open |
| Automated browser-decision coverage | Setup, movement/cancel/confirm, invalid and stale actions, loading, Fight, Encounter, Deploy, terminal states, reconnect, and victory are reachable and observable | Verified by the 2026-10-07 Chrome CI matrix, three-session online harness, temporary-victory route, and keyboard suite. The online victory harness selects later legal commands through authenticated browser-session requests; human completion of the full route remains separate and open |
| Accessibility and visual acceptance | Keyboard/screen-reader playthrough, contrast/focus/target review, responsive visual review, and reviewer sign-off | Open: automated source contracts pass; manual review is outstanding |
| Release evidence | `npm run verify`, deployment health, durable persistence/restart, monitoring, and production smoke evidence | Blocked: deployment and human release evidence remain open |

The checklist is intentionally evidence-based: rows may move from **Blocked** or
**Open** to **Verified** only when the named proof is recorded in this document or
its linked source artifact.

## Current local browser run

The fresh 8 October 2026 `npm run browser:audited:verify` run passed all seven supported board viewports: 320×740, 390×844, 844×390, 768×1024, 1024×768, 1440×900, and 2560×1080. Every viewport completed ordered setup, board pin/render checks for all 336 cells, full-board fit, accessibility-name and feature-detail checks, camera pan/zoom/resize and touch pinch, movement, Encounter, and Deploy. The run reported no page errors, broken images, document overflow, or clipped controls; see `output/board-art/browser-verification.json`. This is automated local-browser evidence and does not close same-scale visual acceptance, independent board review, human full-route acceptance, or manual accessibility review.

| Check | Result | Evidence or limitation |
| --- | --- | --- |
| Clean local session | Pass | Opened the current Vite session at `http://127.0.0.1:5177/` in a fresh browser tab. |
| Ordered monster setup | Pass | Player 1 selected `monster-1`; Player 2 selected `monster-2`. |
| Reverse branch setup | Pass | Player 2 selected Navy; Player 1 selected Army. |
| Lair setup | Pass | Player 1 selected Los Angeles; Player 2 selected Miami. |
| Starting choice | Pass | Both players selected Draw Research. |
| Path preview and confirmation | Pass | Los Angeles → San Francisco; the action card exposed Confirm path and Cancel. |
| Path preview cancellation | Pass | A live run selected the legal San Francisco destination, observed selected/path-highlighted tiles and both confirmation controls, then clicked Cancel; the Cancel control disappeared and selected/path-highlighted tile counts returned to zero without changing the turn log. |
| Fight decision | Pass | Resolve fight advanced the phase. |
| Encounter decision | Pass | Resolve encounter advanced the phase. |
| Deploy decision | Pass | Pass deployment advanced the turn. |
| Repeated phase sequence | Pass | Five local turn cycles reached Move → Fight → Encounter → Deploy repeatedly. |
| Temporary victory | Pass, with follow-up UI verification | A route-oriented run reached `Victory · Zorb` at round 10 after reaching Miami; the terminal presentation was then corrected so no generic post-game Resolve button remains. A fresh post-fix terminal screenshot is still required before treating the browser acceptance as complete. |
| Full cancellation matrix | Not yet verified | One path cancellation and every invalid-action/loading case still need a dedicated run. |
| Refresh/reconnect | Not yet verified in this run | Engine/store coverage exists; browser proof remains separate. |
| Two-browser online play | Not yet verified | Requires two live room participants and WebSocket/polling exercise. |
| Mobile viewport | Scripted viewport pass; human acceptance open | The 320×740, 390×844, and 844×390 audited-board Chrome runs completed setup, camera interactions, movement, encounter, and deployment with no overflow or clipped controls/playback. This is not manual device, browser-engine, or accessibility sign-off. |

## Latest local renderer regression check

On 2026-08-26, `BROWSER_TEST_URL=http://127.0.0.1:5182/ npm run browser:local:matrix` ran the reproducible local smoke at 1280×720, 834×1112, and 390×844. Each fresh session completed setup, verified a main landmark and accessible names for rendered controls, selected a legal destination, verified path cancellation, reconfirmed the path, and observed the next authoritative `Encounter` phase. These are responsive development-fixture checks and do not replace screenshot-level/manual visual and accessibility review or full-board MVP evidence.

On 2026-08-26, `npm run browser:local:verify` drove a fresh headless Chrome session against the current Vite server. The scripted run completed local setup, confirmed an unreachable destination remained disabled without opening movement controls, selected the authored Denver destination, verified that **Cancel** cleared the selected path, selected Denver again, confirmed the path, observed the pending-action loading state, resolved the resulting Fight, resolved Encounter, passed Deploy, verified return to Move, and used the supported Concede action to render the terminal Victory summary and local restart control. This is reproducible local first-playable interaction evidence; it remains development-fixture evidence and does not prove malformed-command handling, the temporary stomp victory condition, the physical MVP board, two-browser online play, or manual accessibility acceptance.

On 2026-08-25, the board-first gameplay shell was checked at 1280×720 after completing the local development setup. With the controls panel closed, the layout measured 1,240px wide and the map surface measured 1,190×405px; the secondary information panel and turn-progress strip were hidden. Opening **Open controls** restored the 340px information panel, turn-progress strip, card/decision controls, and bounded scrolling. This verifies the intended map-first hierarchy for the development fixture only.

The same run opened the owner's card-action surface from the controls panel. Card action controls are owner-only, while the drawn cards themselves are face up and public under the rulebook. Expandable entries exposed implemented/source-gated status plus transcribed timing text where available. This is UI evidence; it does not prove that every source-inventoried card interaction is production-complete.

On 2026-08-25, a clean local browser session completed the two-player development setup and verified the pinned-board renderer: the development board remains authoritative for rules and legal movement, while the visual surface now includes the separated 336-cell candidate shell with nine canonical development overlays and no second lattice. Three legal movement destinations were exposed for the active monster; selecting one showed the authoritative path preview and enabled **Confirm monster move**, while **Cancel** cleared both the path and preview. No browser console errors or page alerts were observed. This remains development-fixture evidence, not MVP board or production acceptance.

The same session checked the viewport shell at 1280×720 and 390×844. In both sizes the document stayed at the viewport height with zero page scroll, the board remained visible, and the mobile board panel used its own bounded scroll surface for lower-detail content. This proves the viewport contract for the development UI only; it does not complete the broader keyboard, screen-reader, contrast, or production browser acceptance items.

A fresh 2026-08-25 local run also completed the ordered setup through the visible browser controls: `monster-1` then `monster-2`, Player 2 Army then Player 1 Navy, Player 1 Los Angeles then Player 2 Miami, and Draw Research for both players. The setup screen advanced to the active Move phase with no developer-tool intervention. This is an updated development-fixture smoke pass; it does not satisfy the full-board MVP or two-browser online acceptance criteria.

The same runtime check confirmed the keyboard focus boundary after starting a local playtest: the setup controls surface is visible and the current-step `Move` heading receives focus (`tabindex=-1`) rather than leaving focus on the document body. The compact board-first panel-closed layout remains available after setup; this proves the setup transition only, not a complete keyboard or assistive-technology playthrough.

On 2026-08-26, `npm run browser:keyboard:verify` drove a fresh headless Chrome session using only Tab traversal and Space activation. It started the temporary development-victory scenario, selected and confirmed the rendered route `San Francisco -> Denver -> Seattle -> Chicago -> Infamy Site -> New York -> Los Angeles`, opened the encounter controls, resolved each encounter, passed Deploy, and reached the terminal Victory summary. This proves the tested development controls are keyboard-operable; it does not constitute a screen-reader/assistive-technology review, manual WCAG acceptance, or full-board MVP evidence.

The same run queried Chrome's accessibility tree at Home, Move, path-confirmation, Encounter, and terminal states. It found the main landmark, named phase heading, named San Francisco hex, named movement/encounter controls, match-status live-region name, and terminal restart control. This is browser accessibility-tree evidence rather than a human screen-reader review; it does not prove assistive-technology announcements, focus narration, or full-board MVP semantics.

On 2026-08-26, `npm run browser:ci:verify` ran from a clean CI-started Vite server. The read-only board-review route reported 336 separated cream faces in 14 staggered rows at 1280x720, 834x1112, and 390x844, with zero horizontal overflow, zero playable tiles, zero unresolved labels, and an individual-cell inspector at each viewport. The local interaction matrix also passed setup, disabled unreachable destinations, path cancellation and confirmation, pending-action loading, Fight, Encounter, Deploy, and concession-terminal checks at all three sizes. This is automated Chrome evidence for the development fixture and review shell; it does not promote the physical board, establish cross-engine compatibility, or replace human visual, touch, zoom, keyboard, or screen-reader acceptance.

The compact 2026-08-25 runtime check at 390×844 also completed ordered setup, opened the action controls, selected the legal San Francisco destination, and exposed both **Confirm path** and **Cancel** without horizontal or document overflow (`scrollWidth=clientWidth=390`, `scrollHeight=clientHeight=844`). The map remained the unresolved candidate shell, so this does not promote the physical MVP board or complete the supported mobile-browser matrix.

On 2026-08-25, a fresh browser session at `http://127.0.0.1:5179/` completed the same visible setup, opened the controls, selected the legal `Los Angeles → San Francisco` destination, confirmed the path, and reached the authoritative Encounter decision with a visible **Resolve encounter** control. The runtime screenshot still shows the unresolved rectangular candidate shell over the generated decorative map treatment; this is useful development-flow evidence and direct confirmation that the current browser is not yet the physical MVP board.

## Latest two-browser online smoke check

On 2026-08-26, `npm run browser:online:verify` drove two player profiles and one spectator profile against the local Vite client and memory API. The harness now selects free ephemeral ports by default and fails if a child service exits before readiness, preventing a stale process from being mistaken for the development API. Browser one created a room; browser two joined it; the spectator joined with the room code; the harness verified the spectator received setup and Move projections with all rule-bearing controls disabled, completed all eight ordered setup choices, clicked **Ready** in both player sessions, verified synchronized Move, terminated and reopened browser one to force a WebSocket/process disconnect, restored its persisted room session, and recovered the same Move state before acting. It then submitted one forged-actor command and one malformed JSON command from the browser, confirmed both were rejected without changing the visible Move phase, reloaded browser two and recovered the same Move phase, selected and confirmed a legal movement in browser one, resolved the resulting legal Fight decision chain, and synchronized all three sessions through Encounter and Deploy back to Move. Finally, it selected the current player’s **Concede match** control, accepted the irreversible-action prompt, verified the authoritative Victory summary in both player sessions and the spectator projection, and reloaded browser two to confirm terminal recovery. This proves local online setup, spectator no-act projection, WebSocket/process disconnect and reconnect recovery, malformed and forged command rejection, readiness, shared phase, reload recovery, synchronized movement, Fight, Encounter, Deploy, concession, terminal projection, and terminal reload recovery for the development fixture. It does not prove a full-rules victory route, persistence across process restart, production board promotion, or deployed-browser acceptance.

The same harness was rerun from a clean ephemeral-server start on 2026-08-26 and returned `ok=true`: setup, spectator no-act, process-disconnect reconnect, forged and malformed command rejection without state change, synchronized Move, Fight, Encounter, Deploy, concession, player and spectator terminal projection, and terminal reload recovery passed. The returned `onlineFight` value was `verified` after the harness selected the legal destination containing the mixed-choice setup deployment. This is still local memory/API development-fixture evidence, not remote or production evidence.

The mixed-choice rerun also covered one player choosing **Development Deploy** and one choosing **Draw Research**. Setup now materializes the selected lairs, starting Research hand, and valid branch-base deployment before the shared Move phase; the board and rule data remain explicitly provisional.

On 2026-10-07, `npm run browser:victory:verify` passed from a fresh headless Chrome session at `http://127.0.0.1:5183/`. It opened the explicit **Run temporary victory test** development scenario and drove the rendered route `San Francisco -> Denver -> Seattle -> Chicago -> Infamy Site -> New York -> Los Angeles`. The fixture uses one marker per stompable development space and no military collisions, while the normal supported-player marker-count helper remains unchanged. The browser selected and confirmed each legal path, resolved each Encounter, passed Deploy, and rendered the authoritative `development-board-exhaustion` terminal summary. This is valid development-fixture victory evidence, not two-player online victory, full-board acceptance, or production-ruleset evidence.

On 2026-08-25, two fresh browser tabs connected to the local API, created and joined room `8A132F`, completed the ordered two-player setup independently, and both reached the setup-complete Move surface. Reloading the second tab restored the same room and retained setup completion without developer-tool intervention. A subsequent Move attempt did not produce a clean observed phase transition in the second tab, so this is partial online setup/reconnect evidence only; the full two-browser play, refresh, disconnect, reconnect, and winner acceptance remains open.

The live development smoke pass then exercised the first complete decision chain after setup: **Move** → **Encounter** → visible **Resolve encounter** control → source-backed city choice (**Take the city Health benefit**) → **Deploy** → **Pass deployment**. Before the fix, the `encounter-resolution` pending decision rendered only a disabled “Choose the Encounter decision” dock label; `PhaseActions` now exposes the authoritative resolution button and the accessibility source contract guards that branch. This remains development-fixture evidence and does not cover every fight/retreat/card/victory path.

The same local browser smoke now exposes a board-adjacent **Normal Fight** surface when the Denver combat fixture is reached. It groups the participating military units and opposing monster, places recorded dice in the centre, shows the current attack decision, and hands legal target/resolve controls to the existing authoritative phase actions. This is presentation evidence only; the engine remains responsible for attack order, targets, rolls, modifiers, damage, smash, destruction, mutation, and subsequent decisions.

An earlier two-tab online smoke pass on 2026-08-25 left the movement transition unverified. The 2026-08-26 three-session development run later verified synchronized movement, Encounter, Deploy, concession, terminal projection, and reload recovery, but had not yet reached Fight. The audited-board run on 2026-10-07, recorded below, supersedes that Fight gap and now proves automated online reachability of a Monster Challenge victory. Human full-route playthrough, process-restart persistence, and deployed-browser acceptance remain open.

## Full-board rendering check

The browser selects its authoritative rules renderer from the active match's immutable board ID and content hash. A new MVP room uses `AUDITED_BOARD` for legal actions, features, and adjacency; the board status notice identifies the 336-cell human-audited definition. Existing provisional match identities remain resolvable for saved matches and explicit playtests. A development playtest still uses only `DEVELOPMENT_BOARD`. The project owner accepted the same-scale board visual review on 11 October 2026; independent board review, full-rules acceptance, two-player online acceptance on the audited identity, and final release sign-off remain open.

On 2026-10-08, `npm run browser:audited:verify` passed at 320×740, 390×844, 844×390, 768×1024, 1024×768, 1440×900, and 2560×1080. The verifier starts a fresh Vite server on an available loopback port unless `BROWSER_TEST_URL` is explicitly supplied. Every viewport asserted the `human-audited-north-america` board pin and matching rendered content hash, completed setup across all 336 cells, exercised camera bounds/zoom/drag/touch/resize (plus minimap and keyboard controls on wider layouts), and completed movement, encounter, and deployment. No page errors, broken images, overflow, clipped controls, or clipped board playback were reported. The report is recorded at `output/board-art/browser-verification.json`. This is local Chrome evidence, not cross-browser, two-player online, manual device, or full release acceptance.

On 2026-10-08, `npm run browser:online:verify` passed with three fresh Chrome sessions and the memory API. It confirmed the same audited board ID, version, and content hash in both players and the spectator; 336 rendered cells; two-player setup and readiness; spectator no-act rules; synchronized movement; browser-process reconnect and Move recovery; malformed and forged command rejection; Fight (`onlineFight: verified`); selection of the actual two-piece battle hex, with both monster and opponent unit shown in the visible, in-map stack inspector without covering the action dock/map controls or changing the room revision at 320×740, 390×844, 844×390, and 768×1024; Encounter playback on the non-acting player's board; Deploy; and a Research draw. The test then used each browser session's own participant token to drive legal engine-selected commands through the API until the audited-board room reached `monster-challenge` victory (winner seat 1, round 9); both players and the spectator rendered the same terminal type, and a player reload retained it. Encounter playback is checked against the authoritative event payload, requiring dice playback when that payload contains rolls. This is automated online-match evidence, not a human full-route playthrough or deployed-browser acceptance; durable database restart recovery remains open. Concession is separately covered by the local browser and API/store checks.

On 2026-10-11, a fresh `npm run browser:online:verify` passed against the current checkout with three new Chrome profiles and the memory API. It confirmed all three sessions share the pinned `human-audited-north-america` board identity and render 336 cells; both players completed setup and readiness, while the spectator remained no-act. The harness recovered a starting giant-placement choice after owner-page refresh, restarted a browser process and recovered the WebSocket session, rejected forged and malformed commands without changing state, restored a refreshed player session, and resolved movement into a six-piece mixed battle stack whose piece artwork remained contained without overlap at 320×740, 390×844, 844×390, and 768×1024 without changing the room revision during inspection. It then reached and synchronized Fight, Encounter, Deploy, a Research draw, and a round-9 Monster Challenge victory across both players and the spectator; terminal reload recovery passed. The later legal commands are still driven by the deterministic test harness. This fresh run strengthens automated online-flow evidence only; human full-route playtesting, managed-database durability, and deployed-browser acceptance remain open. Machine-readable output: `output/board-art/browser-online-verification.json`.

On 2026-10-08, `npm run browser:ci:verify`, `npm run browser:keyboard:verify`, and `npm run browser:victory:verify` passed against the local web app. The CI suite checked the 336-cell review surface, 1–8-piece stack geometry, and interaction flow at desktop, tablet, and mobile sizes; keyboard checks completed ordered setup, board navigation, and the temporary-victory route; the victory run reached its authoritative terminal result. These automated runs do not replace the human full-route, visual, assistive-technology, or deployed-browser acceptance gates.

The current-checkout rerun of `npm run browser:ci:verify` passed after the landscape event-panel placement correction. The read-only board surface exposed and loaded all 336 coordinate-matched images, both reference images, and contained 1–8-piece stacks at 1280×720, 834×1112, and 390×844; the interactive matrix also passed its desktop, tablet, and mobile checks. All three review sizes reported no horizontal overflow or playable controls on the read-only surface. This is automated Chrome evidence and does not close same-scale physical-board acceptance or manual visual/accessibility review.

The current-checkout rerun of `npm run browser:victory:verify` also passed: the browser followed the temporary-victory route from San Francisco through Denver, Seattle, Chicago, the Infamy Site, New York, and Los Angeles, then reported the terminal state verified. The automated temporary-victory fixture remains distinct from a human two-player match.

On 2026-08-26, `npm run browser:online:verify` completed a fresh three-session Chrome run against the normal online MVP room path using the then-current provisional board. It verified public room creation, second-player join, spectator no-act projection, ordered mixed setup, readiness, shared provisional board identity, 336 rendered cells, reconnect/reload recovery, malformed and forged command rejection, synchronized movement, Fight, Encounter, Deploy, concession, and terminal reload. This historical run predates the audited-board promotion; see the 2026-10-07 audited-board online run above for current board identity evidence.

The board notice and accessible tile descriptions identify the nine-space development fixture and its unresolved physical-board cells. Those disclosures do not substitute for verified board data or full-rules browser coverage, and this fixture cannot be used to sign off the MVP playable-game board requirement.

The browser uses a generated decorative sea-and-land treatment beneath the interactive 336-cell overlay. It contains no board keys or rule data; the engine still supplies all current legal actions and recorded features. Internal reference photographs are not shipped in the web client.

## Current geometry correction

After reviewing the supplied comparison image and the responsive-grid reference, the candidate layout contract was tightened. The shared layout now uses flat-top faces, a three-quarter-width horizontal centre pitch, and a half-face-height offset on alternate columns. `npm run web-board-layout:verify` checks polygon-level interior intersections across all 336 candidate cells. This verifies the corrected visible honeycomb presentation, not physical-board topology or MVP promotion.

## Preference and no-audio check

In the updated local browser run, opening **Settings** exposed four persisted preferences: Larger text, Show board labels, Reduce motion, and Confirm disappearance. Toggling Larger text, hiding labels, and enabling Reduce motion changed the root presentation classes and hid only the visual label span while retaining the accessible tile name. The panel also states that no audio dependency exists; required outcomes remain textual. This is UI evidence, not a WCAG AA sign-off or production release approval.

## Keyboard-only full temporary-victory route

On 2026-10-08, `npm run browser:keyboard:verify` passed from fresh local Chrome sessions. The first session completed audited-board setup, unused-branch base choices, menu and settings access, record-tab arrow navigation, map panning, roving-focus board navigation, and a legal move confirmation. A second keyboard-only session opened the Playtest tools disclosure, ran the explicit temporary-victory fixture, and used hex-neighbour arrows, Enter, and Tab/Enter for the route `San Francisco -> Denver -> Seattle -> Chicago -> Infamy Site -> New York -> Los Angeles`. The route completed Fight, Encounter, Deploy, and the authoritative `Victory · Zorb` state. Accessible role/name checks covered the move confirmation, Fight continuation, Deploy pass, victory heading, and **Start another local playtest** control; the verifier returned `ok: true`. The run is development-fixture evidence only. Human screen-reader/assistive-technology review, full-rules two-player victory, supported mobile keyboard acceptance, and production evidence remain open.

The same keyboard-only suite passed again in the current checkout after the 8 October landscape event-panel placement correction. Chrome returned `ok: true`, the same legal route, the expected `Hold this unit` follow-up, and the accessible victory/restart controls; this revalidation adds no screen-reader or human acceptance evidence.

On 2026-10-07, `npm run browser:ci:verify` passed from a fresh Vite server. Its board-review sessions at 1280×720, 834×1112, and 390×844 confirmed 336 coordinate-matched audited terrain-art assignments, all visible cell images and both physical reference images loaded, all cells contained in the board frame, a working cell inspector, contained 1–8 occupant fixtures, and no playable controls, unresolved labels, or horizontal overflow. Its local interaction sessions completed setup and the tested Move, Fight, Encounter, Deploy, and terminal-control flow at desktop, tablet, and mobile sizes. Combined with the online and keyboard runs recorded above, this closes the automated first-playable decision-coverage item. It does not close human full-route, independent board review, screen-reader, or deployment acceptance.

The run exposed and corrected two keyboard barriers: known development-board cells now participate in the same roving focus model as the audited board, with arrow navigation choosing the nearest neighbour in the requested direction; and terminal options automatically expand at game end so the restart action is reachable. Unknown, non-playable board shells remain disabled.

## Consolidated verification

On 2026-10-08, `npm run verify` passed the catalogue, source traceability, board validation and overlays, release evidence, PWA, accessibility, API-origin, responsive layout, API-load, dependency audit, documentation, Prisma schema, 242 engine tests, 112 API tests, typechecks, and production web build gates. The audited-board engine route test completes source-backed setup and verifies Move, Fight, Encounter, and Deploy, consumes the original Stomp markers, activates the delayed Monster Challenge, and resolves a terminal result for each of 2, 3, and 4 players. Starting Research draws now also resolve immediate X-Fighters and giant effects on the audited board, with regressions for the reserve units, giant ownership, base placement, and card discard. Separately, an in-memory API integration route completes the same legal phase sequence and terminal Challenge for three- and four-player rooms through accepted room commands. These are automated engine/API checks, not human browser acceptance or durable-store recovery. Vite reported the existing bundle-size advisory: the minified JavaScript entry is 780.41 kB, above its 500 kB threshold. This consolidated local check does not close independent board review, human visual/assistive-technology acceptance, hosted persistence, or production release gates.

The full `npm run verify` gate passed again on 2026-10-08 after adding the Blonde Lure/Molecular Cannon and Atomic Breath/Berserk timing regressions and the portrait-focused camera adjustment: 246 engine tests and 112 API tests passed, along with source/board/release contracts, typechecks, Prisma validation, dependency audit, docs verification, and production build. The minified JavaScript entry was 781.84 kB and retained the existing 500 kB advisory. `git diff --check` is clean. This current-checkout run still does not close the human, hosted-persistence, or production-release gates listed above.

The 2026-10-08 audited-board browser matrix passed again at 320×740, 390×844,
844×390, 768×1024, 1024×768, 1440×900, and 2560×1080 after fixing city-stomp
playback overlap with the active-hex context tray. The contract now checks that
playback avoids that tray alongside the fixed gameplay controls during the
setup, movement, encounter, and deployment route. All seven runs completed with
no browser errors, broken images, or clipped playback; the refreshed 320×740
capture was visually reviewed. The subsequent full `npm run verify` passed
with 246 engine tests and 112 API tests, typechecks, docs and source/board
contracts, and production build. The minified JavaScript entry was 781.87 kB,
retaining the existing 500 kB advisory; `git diff --check` is clean. Human
visual, assistive-technology, independent board, hosted-persistence, and
production-release acceptance remain open.

The latest board-data regressions verify all 48 signed-off city benefits map to
the correct fixed +1 Health or one-, two-, or three-die result and resolve
through `AUDITED_BOARD`; they also verify all 32 branch bases map to the
reviewed owners across 30 cells, preserving the two co-located spaces. The new
special-site regression checks all 16 Infamy sites, four Mutation sites, four
Challenge sites, 18 lairs, and the single Los Angeles return feature at the
reviewed physical cells. The full `npm run verify` passed with 249 engine and
112 API tests, source/board/release and documentation contracts, typechecks,
Prisma validation, dependency audit, and production build. The minified
JavaScript entry remains 781.87 kB with the existing 500 kB advisory;
`git diff --check` is clean. Independent board review and visual acceptance,
managed persistence, and release deployment remain open.

The audited-board online smoke was rerun on 2026-10-07 from fresh ephemeral
services. The output in
[`output/board-art/browser-online-verification.json`](../output/board-art/browser-online-verification.json)
reports `ok=true`, 336 rendered cells, one shared human-audited board identity,
spectator no-act projections, reconnect and reload recovery, forged/malformed
command rejection without state changes, synchronized movement/Fight/Encounter/
Deploy, Research draw, and an authoritative Monster Challenge victory shown to
both players and the spectator. The test driver selected legal commands after
UI setup, so this remains automated local evidence; human full-route play and
deployed durable-database recovery remain open.

On 2026-10-08, the online harness also passed the source-backed retreat
destination branch and the immediate-giant Research draw continuation. It
measures the live mixed battle stack after movement emphasis settles and
records contained, non-overlapping artwork at 320×740, 390×844, 844×390, and
768×1024 in the same JSON result. The full room flow again reached a shared
Monster Challenge victory and terminal reload recovery. These are automated
local checks; full human gameplay and durable production recovery remain open.

The online harness now checks the authoritative startup decision after both
players are ready. For this run, the test-only memory API seed was set to `8`,
which places Mecha-Monster first in the Military Research deck. The assigned
player selected a legal base through their own browser, then all three sessions
completed the remaining online route through a shared Monster Challenge
victory and terminal reload recovery. The JSON records
`startingGiantPlacement: resolved-by-owner-ui`. The seed override is accepted
only when the API runs in test mode with memory persistence; it does not change
room seeding in production or durable-store runs.

On 2026-10-08, the three-session harness was extended to move five military
units through accepted room commands into a shared empty hex, open that live
stack with the in-game inspection gesture, and verify player-relative
ownership, branch, Health, and movement status without changing the room
revision. The active monster then joins the same hex through the browser UI,
producing a six-piece battle stack whose artwork remains inside its cell
without overlap at 320×740, 390×844, 844×390, and 768×1024. The run also
completes the online route through shared Monster Challenge victory and
terminal reload recovery. This is automated local gameplay evidence; human
visual acceptance and a human full-route playthrough remain open.

An additional 2026-10-08 rerun exposed a transient ordering in the terminal
assertion: the phase heading could be observed just before the summary panel
was mounted. The harness now waits for the authoritative `Victory type:` panel
after the heading and emits page/panel diagnostics if it is absent. The
adjusted three-session run passed, including the 4-piece live stack at all four
viewports, Research placement, reconnect, and the shared terminal result. This
hardens the automated check; a subsequent run advances the live-stack size as
recorded below. Full human acceptance remains open.

The subsequent 2026-10-08 run exercised the larger stack requirement directly:
five military units and their monster reached one hex through legal room
commands. After the accepted-movement emphasis settled, the six rendered pieces
were all contained and pairwise non-overlapping in the live battle stack at all
four viewports. Every piece appeared in the board inspector, and inspection
left the room revision unchanged. The result is recorded in
`liveGameplayStack.mixedStackAfterMonster` and `stackArtworkGeometry` in the
online verification JSON. Human visual acceptance remains separate.
