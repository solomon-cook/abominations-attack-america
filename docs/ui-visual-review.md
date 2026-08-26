# UI visual and responsive review record

This is a review record for the current development playtest surface. It does not approve the unresolved physical board, production ruleset, or public release.

## Reproducible runtime matrix

`npm run browser:local:matrix` runs a fresh headless Chrome session at each supported smoke viewport:

| Viewport | Runtime evidence | Current result |
| --- | --- | --- |
| Desktop 1280 x 720 | Setup, named controls, disabled unreachable destination, path cancel/confirm, loading state, Fight, Encounter, Deploy, return to Move, terminal concession | Pass |
| Tablet 834 x 1112 | Same interaction and control-name checks at tablet dimensions | Pass |
| Mobile 390 x 844 | Same interaction checks with compact layout and no page overflow | Pass |

The matrix is runtime evidence, not a pixel-snapshot baseline. It proves that the required smoke controls remain reachable and that the document does not overflow in the compact case; it does not prove exact typography, artwork, spacing, browser-engine parity, or physical-board fidelity.

`npm run browser:visual:verify` captures a deterministic post-setup PNG at the same three viewports and compares its SHA-256 hash with `docs/browser-visual-baselines.json`. The baselines are Chrome-specific development-playtest evidence: a Chrome upgrade or intentional UI change requires an explicit `UPDATE_BROWSER_VISUAL_BASELINES=1` review and commit. This is not cross-engine browser proof, human visual acceptance, or physical-board fidelity evidence.

## Review findings

- The active match is board-first after setup; the secondary controls remain behind an explicit toggle.
- The action dock is outside the map surface and does not cover rule-bearing cells.
- The local development match clearly labels itself as a nine-space source-gated fixture.
- The full 254-cell candidate is available only through the explicitly labelled read-only board review surface; it is not silently mixed into a development match.
- The responsive contract covers dynamic viewport sizing, safe areas, touch-target rules, reduced motion, map containment, and compact action controls.

## Acceptance boundary

Automated source contracts, build/typecheck, runtime smoke, and the candidate geometry check pass. Final visual acceptance remains open for a human reviewer at the supported desktop, tablet, and mobile targets, including typography/artwork judgement, browser-engine comparison, keyboard-only play, screen-reader play, zoom, focus, reduced-motion, and touch review. Physical board content remains separately source-gated.

The motion contract is now automated separately: `npm run web-motion:verify` confirms all authored CSS animations are finite, transient path feedback settles to explicit end states, transition durations are bounded, and the reduced-motion media query globally clamps animation and transition duration so presentation can be interrupted without changing authoritative match state. This is implementation evidence, not a substitute for human reduced-motion or visual acceptance.

Safari remains an explicit QA gap: SafariDriver was available locally and reported ready on 2026-08-26, but the bounded WebDriver session-creation probe timed out before a browser session was returned. The Chrome matrix and baselines must not be presented as cross-engine evidence.

On 2026-08-26, the clean CI browser matrix also measured every visible map, header,
action-dock, and phase control used by the local smoke at 1280×720, 834×1112,
and 390×844. All measured controls met the 44px minimum target contract. This
is runtime evidence for the development fixture; it does not replace manual
touch, zoom, focus, assistive-technology, or physical-board acceptance.
