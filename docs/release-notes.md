# Release notes — development checkpoint

## Current checkpoint

- Shared deterministic engine, HTTP rooms, WebSocket updates, polling fallback, persistence boundaries, spectator projections, and reconnect-safe command receipts are implemented for the development fixture.
- The browser renders only the board definition pinned by the active match. Development playtests use the nine-space fixture, whose off-shell compatibility locations are shown as compact separated flat-top hex pins; the unresolved 254-cell shell remains review tooling and is not playable.
- Settings include larger text, board-label visibility, reduced motion, and disappearance/concession confirmation behavior.
- Voluntary concession, safe terminal return, local rematch, deterministic malformed-command coverage, bounded concurrency coverage, asset checks, and accessibility source checks are included.

## Not a production release

This checkpoint is not a public rules-complete release. Production room creation remains fail-closed until the full physical board is transcribed, validated, and signed off. Challenge rules, complete card effects, full browser/online QA, deployed infrastructure, privacy approval, content/IP approval, and release operations remain outstanding.
