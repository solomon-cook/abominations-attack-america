# Fullscreen Civ-style gameplay UI plan

## Intent

Make the active match feel like a game surface rather than a conventional web page. The board should own the full viewport, remain visible while the player acts, and support bounded pan/zoom. UI should be attached to the screen edges or appear contextually over the board without pushing the board into a document layout.

This is a presentation-layer change only. Engine legality, board identity, match state, pending decisions, and command authority remain unchanged.

## Target composition

```text
fixed viewport
├── top edge: compact global status / phase / connection strip
├── full canvas: board camera with pan and zoom
├── bottom-left: player monster and branch status controls
├── bottom-centre/right: current legal action dock and attention feedback
├── selected object: board-adjacent contextual tray or anchored popover
└── right edge: optional information rail, opened without reflowing the board
```

## Planned changes

1. Replace the active-game document flow with a `position: fixed`/viewport-height game shell that has no page scrolling.
2. Make the board canvas fill the available viewport behind the interface chrome. Keep the existing camera transform, bounded zoom, pan limits, Fit/Reset controls, and pointer/touch interaction.
3. Move phase, active-player, connection, and Stomp/Challenge context into a compact top-edge overlay. It must collapse or simplify at narrow widths rather than consume board height.
4. Anchor the action dock to the bottom edge and keep the current authoritative action tray available without opening a controls panel.
5. Anchor monster/branch status controls to the bottom-left edge and keep their detail lightboxes overlaid rather than layout-expanding.
6. Convert the secondary panel into a right-edge drawer/rail. Opening it must overlay or reserve a controlled edge strip without changing board coordinates or camera state.
7. Keep selected-hex, selected-piece, stack, encounter, fight, and card detail in contextual trays/popovers that preserve the board and remain dismissible.
8. Give setup, onboarding, settings, terminal results, and Challenge presentation explicit overlay layers with focus management and Escape/close paths.
9. Define desktop, tablet, and mobile compositions separately: desktop right rail; tablet narrower rail or bottom sheet; mobile bottom sheet with the board still filling the background.
10. Retain the provisional-board notice, source-gated labels, spectator no-action state, keyboard focus states, reduced-motion behavior, and accessible names in every composition.

## Acceptance criteria

- The active game has no document-level scroll at supported viewports.
- The board remains full-width/full-height behind the UI and is never resized into a normal content column when details open.
- Pan, zoom, Fit/Reset, legal destination highlighting, and path previews remain unchanged in engine meaning and usable by pointer, touch, keyboard, and screen reader.
- Top, bottom, and side UI stays attached to viewport edges while the board camera moves underneath it.
- Opening and closing details does not change board coordinates, selected paths, pending decisions, or command payloads.
- Every required action remains visible or reachable contextually without a generic “Show controls” dependency.
- No overlay hides a required legal destination or the active decision without an accessible alternative.
- Desktop, tablet, mobile, reduced-motion, keyboard, screen-reader, and spectator checks pass.
- The project owner accepted the screenshots and current composition at 1280×720, 834×1112, and 390×844 on 2026-10-11 with no issues found; the result may be reopened if an issue is found later.

## Implementation order

1. Introduce the fixed viewport shell and board camera layer.
2. Re-anchor status, action, and player controls to viewport edges.
3. Convert the secondary panel and contextual trays into overlay/drawer layers.
4. Add responsive compositions and focus/escape behavior.
5. Run automated layout/accessibility/browser checks, then perform manual visual and touch review.

## Non-goals

This plan does not change the provisional board data, board topology, rules, card effects, artwork ownership, production hosting, or source-verification status. It also does not copy Civilization VI artwork, branding, or proprietary UI assets.

## Implementation evidence

The active game shell now ends with a fixed viewport contract in `apps/web/src/fullscreen-shell.css`: it owns `100dvh`, clips document-level overflow, keeps the board panel as the flexible camera layer, and preserves the narrow-screen composition without reverting to normal page flow. On 2026-08-26, `npm run browser:local:matrix` passed at 1280x720, 834x1112, and 390x844, covering setup, accessible controls, touch targets, disabled unreachable destinations, loading, path cancellation/confirmation, Fight, Encounter, Deploy, and concession-terminal rendering. The browser smoke also verifies that opening the desktop/tablet details rail leaves the board rectangle unchanged and keeps document overflow bounded. The project owner accepted the current UI visual review at supported desktop, tablet, and mobile sizes on 2026-10-11 with no issues found and the option to reopen it later. Physical touch, zoom, screen-reader, keyboard, reduced-motion, and cross-browser acceptance remain separate release evidence requirements.

On 2026-10-10, a fresh `npm run browser:local:matrix` rerun passed at 1280x720, 834x1112, and 390x844. Each case also completed the guided first-turn solo route, verified that routine city dice play stays inline, kept the player's record available during the bot turn, and confirmed that camera-follow is opt-in. The review captures are `output/board-art/ui-minimap-1280x720.png`, `output/board-art/ui-minimap-834x1112.png`, and `output/board-art/ui-minimap-390x844.png`. I inspected the three captures: the game board remains the dominant surface behind the open record/action overlays, and the measured test route reports no viewport overflow or overlay collisions. These captures are from the same in-game map overview state, not an independent physical-board comparison. Human visual, touch, zoom, and screen-reader acceptance remain open.

Also on 2026-10-10, `npm run browser:keyboard:verify` passed at 1280x720 through ordered setup and unused-branch placement, menu/settings, record-tab arrow navigation, minimap arrow-key panning, roving-focus board arrows, and a complete temporary-victory route through Fight, Encounter, and Deploy. `npm run web-a11y:verify` passed its source contract. Project-owner visual acceptance is recorded in the current status above; manual WCAG/assistive-technology review, reduced-motion behavior in a real playthrough, and physical-touch acceptance remain open.

`BROWSER_TEST_REDUCED_MOTION=1 BROWSER_LOCAL_VIEWPORTS=390x844 npm run browser:local:verify` also passed on 2026-10-10. The standard mobile gameplay context emulated `prefers-reduced-motion: reduce`; the script's separate guided-solo context uses default motion, so the result does not replace inspection of event/dice animation behavior in the reduced-motion context.

On 2026-10-11, Chrome CDP touch-input checks passed at 390×844, 320×740, and 844×390. Above the centered 1× fit view, one-finger drags changed the board transform without selecting a tile, and two-finger pinches increased camera zoom. The 320×740 and 844×390 results are in `output/board-art/browser-verification.json`; this verifies browser-emulated event handling and does not replace physical-device touch review.
