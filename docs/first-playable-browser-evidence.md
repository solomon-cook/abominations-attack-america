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

## Current local browser run

| Check | Result | Evidence or limitation |
| --- | --- | --- |
| Clean local session | Pass | Opened the current Vite session at `http://127.0.0.1:5177/` in a fresh browser tab. |
| Ordered monster setup | Pass | Player 1 selected `monster-1`; Player 2 selected `monster-2`. |
| Reverse branch setup | Pass | Player 2 selected Navy; Player 1 selected Army. |
| Lair setup | Pass | Player 1 selected Los Angeles; Player 2 selected Miami. |
| Starting choice | Pass | Both players selected Draw Research. |
| Path preview and confirmation | Pass | Los Angeles → San Francisco; the action card exposed Confirm path and Cancel. |
| Fight decision | Pass | Resolve fight advanced the phase. |
| Encounter decision | Pass | Resolve encounter advanced the phase. |
| Deploy decision | Pass | Pass deployment advanced the turn. |
| Repeated phase sequence | Pass | Five local turn cycles reached Move → Fight → Encounter → Deploy repeatedly. |
| Temporary victory | Pass, with follow-up UI verification | A route-oriented run reached `Victory · Zorb` at round 10 after reaching Miami; the terminal presentation was then corrected so no generic post-game Resolve button remains. A fresh post-fix terminal screenshot is still required before treating the browser acceptance as complete. |
| Full cancellation matrix | Not yet verified | One path cancellation and every invalid-action/loading case still need a dedicated run. |
| Refresh/reconnect | Not yet verified in this run | Engine/store coverage exists; browser proof remains separate. |
| Two-browser online play | Not yet verified | Requires two live room participants and WebSocket/polling exercise. |
| Mobile viewport | Not yet verified | Desktop browser evidence does not prove mobile usability. |

## Latest local renderer regression check

On 2026-08-25, the board-first gameplay shell was checked at 1280×720 after completing the local development setup. With the controls panel closed, the layout measured 1,240px wide and the map surface measured 1,190×405px; the secondary information panel and turn-progress strip were hidden. Opening **Open controls** restored the 340px information panel, turn-progress strip, card/decision controls, and bounded scrolling. This verifies the intended map-first hierarchy for the development fixture only.

The same run opened the private hand surface from the controls panel. Held cards remained visible only to the current player, and expandable entries exposed implemented/source-gated status plus transcribed timing text where available. This is UI evidence; it does not prove that every source-inventoried card is implemented or that production card timing is complete.

On 2026-08-25, a clean local browser session completed the two-player development setup and verified 261 rendered board buttons: 254 candidate-shell cells plus seven development-fixture overlays for the named coordinates outside that shell. Three legal movement destinations were exposed for the active monster; selecting one showed the authoritative path preview and enabled **Confirm monster move**, while **Cancel** cleared both the path and preview. No browser console errors or page alerts were observed. This remains development-fixture evidence, not MVP board or production acceptance.

The same session checked the viewport shell at 1280×720 and 390×844. In both sizes the document stayed at the viewport height with zero page scroll, the board remained visible, and the mobile board panel used its own bounded scroll surface for lower-detail content. This proves the viewport contract for the development UI only; it does not complete the broader keyboard, screen-reader, contrast, or production browser acceptance items.

A fresh 2026-08-25 local run also completed the ordered setup through the visible browser controls: `monster-1` then `monster-2`, Player 2 Army then Player 1 Navy, Player 1 Los Angeles then Player 2 Miami, and Draw Research for both players. The setup screen advanced to the active Move phase with no developer-tool intervention. This is an updated development-fixture smoke pass; it does not satisfy the full-board MVP or two-browser online acceptance criteria.

The same runtime check confirmed the keyboard focus boundary after starting a local playtest: the setup controls surface is visible and the current-step `Move` heading receives focus (`tabindex=-1`) rather than leaving focus on the document body. The compact board-first panel-closed layout remains available after setup; this proves the setup transition only, not a complete keyboard or assistive-technology playthrough.

The live development smoke pass then exercised the first complete decision chain after setup: **Move** → **Encounter** → visible **Resolve encounter** control → source-backed city choice (**Take the city Health benefit**) → **Deploy** → **Pass deployment**. Before the fix, the `encounter-resolution` pending decision rendered only a disabled “Choose the Encounter decision” dock label; `PhaseActions` now exposes the authoritative resolution button and the accessibility source contract guards that branch. This remains development-fixture evidence and does not cover every fight/retreat/card/victory path.

## Full-board rendering check

The local browser renders all 254 cells from `FULL_HONEYCOMB_BOARD` as positioned hex tiles and adds seven explicitly labelled development-fixture overlay spaces whose coordinates fall outside that candidate shell. A DOM check therefore records 261 `[data-hex-key]` buttons in the development playtest: 254 candidate cells plus seven named fixture spaces. The map exposes both the development match board ID/hash and the separately rendered candidate board ID/hash, so this visual check does not falsely claim that the current match has been promoted to the authoritative physical board.

The board notice and accessible tile descriptions identify the nine-space development fixture and its unresolved physical-board cells. Those disclosures do not substitute for verified board data or full-rules browser coverage, and this fixture cannot be used to sign off the MVP playable-game board requirement.

The browser now uses the optimized top-down board photograph as a subdued visual backdrop beneath the interactive 254-cell overlay. The photograph is explicitly labelled as reference-only; the engine still supplies all current legal actions and recorded features.

## Current geometry correction

After reviewing the supplied 1280×706 comparison image, the candidate layout contract was tightened. The previous 75%-of-width horizontal pitch caused the rendered flat-top polygons to overlap. The shared layout now uses the actual 4.45% landscape tile width as its row pitch, applies only a half-width offset to alternating rows, and checks polygon-level interior intersections across all 254 candidate cells. `npm run web-board-layout:verify` passes this regression. A fresh local browser run at 1280×720 rendered 261 tile buttons (254 unresolved candidate cells plus seven named development overlays); this verifies the corrected candidate geometry, not physical-board topology or MVP promotion.

## Preference and no-audio check

In the updated local browser run, opening **Settings** exposed four persisted preferences: Larger text, Show board labels, Reduce motion, and Confirm disappearance. Toggling Larger text, hiding labels, and enabling Reduce motion changed the root presentation classes and hid only the visual label span while retaining the accessible tile name. The panel also states that no audio dependency exists; required outcomes remain textual. This is UI evidence, not a WCAG AA sign-off or production release approval.
