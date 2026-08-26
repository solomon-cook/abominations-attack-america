# Release notes — development checkpoint

## Current checkpoint

- Shared deterministic engine, HTTP rooms, WebSocket updates, polling fallback, persistence boundaries, spectator projections, and reconnect-safe command receipts are implemented for the development fixture.
- The browser renders only the board definition pinned by the active match for rules and legality. Development playtests use the nine-space fixture, whose canonical locations appear as compact separated flat-top overlays on a disabled 254-cell candidate shell; unresolved shell cells remain non-playable and source-gated.
- Settings include larger text, board-label visibility, reduced motion, and disappearance/concession confirmation behavior.
- Voluntary concession, safe terminal return, local rematch, deterministic malformed-command coverage, bounded concurrency coverage, asset checks, and accessibility source checks are included.

## Not a production release

This checkpoint is not a public rules-complete release. Production room creation remains fail-closed until the full physical board is transcribed, validated, and signed off. Challenge rules, complete card effects, full browser/online QA, deployed infrastructure, privacy approval, content/IP approval, and release operations remain outstanding.

## Support

The documented [GitHub Issues support route](../SUPPORT.md) is publicly
reachable, but issue creation is currently restricted. It is not an active
support channel until that access restriction is removed or an alternative
route is published. Please do not include secrets, room tokens, private game
information, or personal data in any report.
