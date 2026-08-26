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

Chrome/Chromium runtime smoke and visual baselines pass at the checked desktop, tablet, and mobile viewports. `npm run browser:safari:verify` exercises the same Vite review surface through Safari WebDriver and runs strictly in the macOS CI job. GitHub Actions run `32942665440` passed this job on `macos-14`: Safari created a session, opened the board-review surface, and verified the 254-cell candidate plus two reference images without horizontal overflow. The same run passed headless Firefox with Geckodriver, Edge's Chromium DevTools interaction smoke, and Chrome's runtime smoke. The generic CI verifier now warns rather than failing when the preserved local provisional ledger is absent; strict source review remains available with `REQUIRE_PROVISIONAL_BOARD_LEDGER=1`. Manual cross-engine acceptance remains open.

The current head was revalidated by GitHub Actions run `32963047100` on 2026-08-26. Its Validate, Chrome browser-smoke, keyboard, Firefox, Safari, and Edge jobs all passed, including the live 7–8 occupant stack class changes. This is current automated CI evidence; manual cross-engine, touch, screen-reader, and source-faithful physical-board acceptance remain open.
