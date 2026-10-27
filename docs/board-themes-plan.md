# Browser-local board themes

**Status:** first presentation-only theme increment implemented; art direction acceptance remains open.
**Roadmap source:** `TODO.md`, Milestone 15.

## User need and scope

The existing play preferences already support text size, board labels, and reduced motion. Add a keyboard-operable way to choose a board palette for visual preference and readability. The first increment offers Classic, Moonlit, and Desert treatments of the same authored terrain images. It does not change board identity, printed information, units, rules, or available actions.

## Privacy and operating cost

- Store the selected theme only in browser-local preferences; do not add account data, telemetry, or a service.
- CSS filters reuse the current artwork, so the feature adds no image downloads or external assets.
- The theme is not synced between devices and falls back to Classic if local storage is unavailable or contains an unsupported value.

## Compatibility and acceptance

- Keep theme preference outside engine state, room projections, saved games, and replay data.
- Apply color treatment to terrain images only. Keep labels, feature symbols, pieces, legal-action outlines, and authoritative source art unchanged.
- Preserve a native labeled select control, the current Classic appearance by default, and the full game interaction layout.
- Verify all options in a browser, including immediate application and browser-local persistence, and run the accessibility contract.
- Human review must confirm that all three treatments remain legible and visually appropriate before the broader original animation/VFX/audio/theme feature can be called complete.

## Implementation record — 2026-10-10

The play-preferences panel now offers Classic, Moonlit, and Desert. The selection is stored under `abominations-board-theme`; unknown values safely resolve to Classic. The palette filters are scoped to audited terrain artwork, leaving game state and feature overlays unchanged. Browser accessibility and persistence verification is recorded in `TODO.md` when the focused checks pass.
