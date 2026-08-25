# Supported browser targets

The first-playable web target is evergreen browsers with JavaScript, WebSocket, CSS Grid, `100dvh`, and `prefers-reduced-motion` support:

| Surface | Supported target | Required QA |
| --- | --- | --- |
| Desktop | Latest two stable releases of Chrome, Edge, Firefox, and Safari on macOS/Windows | Keyboard, zoom, reconnect, and room play |
| Tablet | Latest two stable Safari and Chromium releases on iPadOS and Android tablets | Touch targets, safe areas, orientation, and board fit |
| Mobile | Latest two stable Safari on iOS and Chromium-based Android browsers | Dynamic viewport, installed-browser safe areas, touch, and compact prompts |

Unsupported or legacy browsers must receive a readable unsupported-browser message rather than a partially functioning match. Browser QA remains separate from typecheck, build, and engine proof.

The web client enforces this boundary at startup with a capability check for Fetch, WebSocket, `crypto.randomUUID`, storage, and dynamic viewport CSS support. Unsupported clients receive a static explanatory surface before room or match state is started. This guard does not replace manual QA across the supported browser matrix.
