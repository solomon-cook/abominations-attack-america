# Supported browser targets

The first-playable web target is evergreen browsers with JavaScript, WebSocket, CSS Grid, `100dvh`, and `prefers-reduced-motion` support:

| Surface | Supported target | Required QA |
| --- | --- | --- |
| Desktop | Latest two stable releases of Chrome, Edge, Firefox, and Safari on macOS/Windows | Keyboard, zoom, reconnect, and room play |
| Tablet | Latest two stable Safari and Chromium releases on iPadOS and Android tablets | Touch targets, safe areas, orientation, and board fit |
| Mobile | Latest two stable Safari on iOS and Chromium-based Android browsers | Dynamic viewport, installed-browser safe areas, touch, and compact prompts |

Unsupported or legacy browsers must receive a readable unsupported-browser message rather than a partially functioning match. Browser QA remains separate from typecheck, build, and engine proof.

The web client enforces this boundary at startup with a capability check for Fetch, WebSocket, `crypto.randomUUID`, storage, and dynamic viewport CSS support. Unsupported clients receive a static explanatory surface before room or match state is started. This guard does not replace manual QA across the supported browser matrix.

## Current local evidence

Chrome/Chromium runtime smoke and visual baselines pass at the checked desktop, tablet, and mobile viewports. `npm run browser:safari:verify` exercises the same Vite review surface through Safari WebDriver and runs strictly in the macOS CI job. GitHub Actions run `32940669162` passed this job on `macos-14`: Safari created a session, opened the board-review surface, and verified the 254-cell candidate plus two reference images without horizontal overflow. The local Safari 26.6.2 WebDriver service still times out during `POST /session`; Firefox/Edge coverage and manual cross-engine acceptance remain open.
