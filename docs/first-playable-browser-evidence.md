# First-playable browser evidence

This checklist records browser evidence separately from engine, build, and source-data verification. It is currently an evidence-in-progress artifact for the development fixture, not a release sign-off. The development fixture is not the MVP board: first-playable acceptance requires the fully filled authoritative honeycomb board.

Production room creation is now fail-closed at the same boundary: `createMvpRoomGame` rejects the unresolved full-board candidate, and both Memory and Prisma room stores use that constructor unless a test explicitly opts into `allowDevelopmentFixture`. The local browser remains clearly labelled as a development playtest while source transcription is incomplete.

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
| Authoritative board | Reviewed full-board transcription, stable IDs/coordinates, water and edge data, validation output, and human sign-off | Blocked: source transcription is incomplete |
| Shared match board | Engine, API, and browser record the same board ID and content hash; production room creation succeeds only for that board | Blocked: full-board candidate is unresolved and production creation fails closed |
| Two-player setup and turn loop | Clean supported-browser run covers setup, Move, Fight, Encounter, Deploy, cancellation, invalid/stale recovery, and victory | Partial: development-fixture evidence exists; full-board run is unavailable |
| Refresh and reconnect | Browser evidence shows the pending decision and terminal result survive refresh/disconnect/reconnect without duplicate actions | Open: engine/API coverage exists, browser proof is missing |
| Two-browser online play | Two independent supported-browser sessions complete a match and observe the same revisions, decisions, and winner | Open: local setup/reload smoke is partial |
| Mobile interaction | The same required decisions complete at each supported mobile viewport with no hidden required controls or overflow | Partial: 390×844 development smoke exists; full matrix is open |
| Accessibility and visual acceptance | Keyboard/screen-reader playthrough, contrast/focus/target review, responsive visual review, and reviewer sign-off | Open: automated source contracts pass; manual review is outstanding |
| Release evidence | `npm run verify`, deployment health, durable persistence/restart, monitoring, and production smoke evidence | Blocked: no deployed environment or authoritative board promotion |

The checklist is intentionally evidence-based: rows may move from **Blocked** or
**Open** to **Verified** only when the named proof is recorded in this document or
its linked source artifact.

## Current local browser run

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
| Mobile viewport | Partial pass | A fresh 390×844 runtime completed setup and exposed `Confirm path`/`Cancel`; the document remained exactly 390px wide with no page or horizontal overflow. This is development-fixture evidence, not the full supported-browser matrix or accessibility sign-off. |

## Latest local renderer regression check

On 2026-08-26, `npm run browser:local:verify` drove a fresh headless Chrome session against the current Vite server. The scripted run completed local setup, selected a legal destination, verified that **Cancel** cleared the selected path, selected the destination again, confirmed the path, and observed the next authoritative phase (`Encounter`). This is reproducible local first-playable interaction evidence; it remains development-fixture evidence and does not prove the physical MVP board, two-browser online play, or manual accessibility acceptance.

On 2026-08-25, the board-first gameplay shell was checked at 1280×720 after completing the local development setup. With the controls panel closed, the layout measured 1,240px wide and the map surface measured 1,190×405px; the secondary information panel and turn-progress strip were hidden. Opening **Open controls** restored the 340px information panel, turn-progress strip, card/decision controls, and bounded scrolling. This verifies the intended map-first hierarchy for the development fixture only.

The same run opened the private hand surface from the controls panel. Held cards remained visible only to the current player, and expandable entries exposed implemented/source-gated status plus transcribed timing text where available. This is UI evidence; it does not prove that every source-inventoried card is implemented or that production card timing is complete.

On 2026-08-25, a clean local browser session completed the two-player development setup and verified the pinned-board renderer: development matches render only the development board, with no unresolved full-board shell or second lattice mixed into the match. Three legal movement destinations were exposed for the active monster; selecting one showed the authoritative path preview and enabled **Confirm monster move**, while **Cancel** cleared both the path and preview. No browser console errors or page alerts were observed. This remains development-fixture evidence, not MVP board or production acceptance.

The same session checked the viewport shell at 1280×720 and 390×844. In both sizes the document stayed at the viewport height with zero page scroll, the board remained visible, and the mobile board panel used its own bounded scroll surface for lower-detail content. This proves the viewport contract for the development UI only; it does not complete the broader keyboard, screen-reader, contrast, or production browser acceptance items.

A fresh 2026-08-25 local run also completed the ordered setup through the visible browser controls: `monster-1` then `monster-2`, Player 2 Army then Player 1 Navy, Player 1 Los Angeles then Player 2 Miami, and Draw Research for both players. The setup screen advanced to the active Move phase with no developer-tool intervention. This is an updated development-fixture smoke pass; it does not satisfy the full-board MVP or two-browser online acceptance criteria.

The same runtime check confirmed the keyboard focus boundary after starting a local playtest: the setup controls surface is visible and the current-step `Move` heading receives focus (`tabindex=-1`) rather than leaving focus on the document body. The compact board-first panel-closed layout remains available after setup; this proves the setup transition only, not a complete keyboard or assistive-technology playthrough.

The compact 2026-08-25 runtime check at 390×844 also completed ordered setup, opened the action controls, selected the legal San Francisco destination, and exposed both **Confirm path** and **Cancel** without horizontal or document overflow (`scrollWidth=clientWidth=390`, `scrollHeight=clientHeight=844`). The map remained the unresolved candidate shell, so this does not promote the physical MVP board or complete the supported mobile-browser matrix.

On 2026-08-25, a fresh browser session at `http://127.0.0.1:5179/` completed the same visible setup, opened the controls, selected the legal `Los Angeles → San Francisco` destination, confirmed the path, and reached the authoritative Encounter decision with a visible **Resolve encounter** control. The runtime screenshot still shows the unresolved rectangular candidate shell over the generated decorative map treatment; this is useful development-flow evidence and direct confirmation that the current browser is not yet the physical MVP board.

## Latest two-browser online smoke check

On 2026-08-26, `npm run browser:online:verify` drove two fresh Chrome profiles against the local Vite client and memory API. Browser one created room `F53EE3`; browser two joined it; the harness completed all eight ordered setup choices, clicked **Ready** in both sessions, verified both reached the synchronized Move phase, reloaded browser two and recovered the same Move phase, then selected and confirmed one legal movement in browser one. Both sessions observed the same settled next phase (`Encounter`) after the transient server acknowledgement cleared. This proves local online setup, readiness, shared phase, reload recovery, and one synchronized movement. It does not prove disconnect/reconnect, full fight/encounter/deploy progression, victory, persistence, production board promotion, or deployed-browser acceptance.

On 2026-08-25, two fresh browser tabs connected to the local API, created and joined room `8A132F`, completed the ordered two-player setup independently, and both reached the setup-complete Move surface. Reloading the second tab restored the same room and retained setup completion without developer-tool intervention. A subsequent Move attempt did not produce a clean observed phase transition in the second tab, so this is partial online setup/reconnect evidence only; the full two-browser play, refresh, disconnect, reconnect, and winner acceptance remains open.

The live development smoke pass then exercised the first complete decision chain after setup: **Move** → **Encounter** → visible **Resolve encounter** control → source-backed city choice (**Take the city Health benefit**) → **Deploy** → **Pass deployment**. Before the fix, the `encounter-resolution` pending decision rendered only a disabled “Choose the Encounter decision” dock label; `PhaseActions` now exposes the authoritative resolution button and the accessibility source contract guards that branch. This remains development-fixture evidence and does not cover every fight/retreat/card/victory path.

A fresh two-tab online smoke pass on 2026-08-25 created and joined one local room, completed the ordered setup from separate player tabs, and confirmed both tabs reached the setup-complete Move surface. Reloading the second tab restored the same room and Move phase with the setup surface gone. A subsequent online Move remained on the first tab's path-preview state instead of producing a clean observed transition in the second tab, so the full two-browser play/reconnect/winner criterion remains open.

## Full-board rendering check

The browser selects its renderer from the active match's immutable board ID and content hash. A development playtest renders only `DEVELOPMENT_BOARD`; a future promoted match will render only the reviewed `FULL_HONEYCOMB_BOARD`. The browser no longer overlays the unresolved full-board shell on a development match or exposes a second topology. The full-board candidate remains available to layout/evidence tooling, but it is not a playable or player-facing match board until production validation succeeds.

The board notice and accessible tile descriptions identify the nine-space development fixture and its unresolved physical-board cells. Those disclosures do not substitute for verified board data or full-rules browser coverage, and this fixture cannot be used to sign off the MVP playable-game board requirement.

The browser uses a generated decorative sea-and-land treatment beneath the interactive 254-cell overlay. It contains no board keys or rule data; the engine still supplies all current legal actions and recorded features. Internal reference photographs are not shipped in the web client.

## Current geometry correction

After reviewing the supplied 1280×706 comparison image, the candidate layout contract was tightened. The previous 75%-of-width horizontal pitch caused the rendered flat-top polygons to overlap. The shared layout now uses the actual 4.45% landscape tile width as its row pitch, locks the board to a landscape aspect-ratio canvas so vertical percentage coordinates cannot compress the rows, applies only a half-width offset to alternating rows, and checks polygon-level interior intersections across all 254 candidate cells. `npm run web-board-layout:verify` passes this regression. A fresh local browser run at 1280×720 rendered 254 candidate hexes plus seven compact development pins; this verifies the corrected candidate geometry, not physical-board topology or MVP promotion.

## Preference and no-audio check

In the updated local browser run, opening **Settings** exposed four persisted preferences: Larger text, Show board labels, Reduce motion, and Confirm disappearance. Toggling Larger text, hiding labels, and enabling Reduce motion changed the root presentation classes and hid only the visual label span while retaining the accessible tile name. The panel also states that no audio dependency exists; required outcomes remain textual. This is UI evidence, not a WCAG AA sign-off or production release approval.
