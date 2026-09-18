# Gameplay UI checklist from this chat

Implementation and browser verification are required before checking an item.

- [x] Visual monster lineup with clear selection, hover/focus ability and stats, and touch access.
- [x] Bottom selected-piece profile with key information and relevant actions.
- [x] Persistent bottom-right next-step button covering movement, phases, encounters, deployment and decisions.
- [x] Occupied destinations preserve the moving unit and preview its legal path.
- [x] Compact menus that keep the board and actions accessible on desktop and mobile.
- [x] Unit selection and activation center the camera at moderate zoom; ordinary destination clicks do not recenter it.
- [x] Decorative, inaccessible deep-sea hex border permits coastal centering while keeping the viewport filled.
- [x] Verify the complete selection → movement → confirmation → next-phase flow in the browser.

The existing root TODO.md remains the broader release roadmap.

`node scripts/verify-chat-unit.mjs` deploys two navy fighters, selects one, clicks the other fighter's artwork, confirms the original fighter's path and verifies both pieces occupy the destination.

Evidence: `node scripts/verify-chat-ui.mjs` passes at 1440×900 and 390×844 for monster artwork/lineup, setup, visible profile, movement confirmation, encounter decisions and advancing to Player 2. `npm run board-camera:verify` proves all 336 tile centers can be centered at 155% across four viewport sizes and checks padded bounds. The military browser check also asserts unit centering and camera stability during destination selection. The UI check verifies that menus preserve the next-action button and that the bottom profile does not overlap it. Desktop/mobile screenshots were visually inspected. TypeScript, production build and git diff whitespace checks pass.
