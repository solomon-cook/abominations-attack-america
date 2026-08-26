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
- The development match visibly renders the 254-cell candidate shell with nine canonical development overlays; the shell faces are disabled and neutral, and the separately labelled board review surface remains the only place where unresolved cells can be inspected.
- The responsive contract covers dynamic viewport sizing, safe areas, touch-target rules, reduced motion, map containment, and compact action controls.
- The rendered candidate faces use the same 4.45% width as the canonical display lattice. The source layout contract and Chrome smoke now also verify 13 staggered rows and non-negative same-row gaps at desktop, tablet, and mobile sizes; this guards against the earlier class of per-face width drift that could make neighbouring hexes overlap.

## Acceptance boundary

Automated source contracts, build/typecheck, runtime smoke, and the candidate geometry check pass. Final visual acceptance remains open for a human reviewer at the supported desktop, tablet, and mobile targets, including typography/artwork judgement, browser-engine comparison, keyboard-only play, screen-reader play, zoom, focus, reduced-motion, and touch review. Physical board content remains separately source-gated.

The motion contract is now automated separately: `npm run web-motion:verify` confirms all authored CSS animations are finite, transient path feedback settles to explicit end states, transition durations are bounded, and the reduced-motion media query globally clamps animation and transition duration so presentation can be interrupted without changing authoritative match state. This is implementation evidence, not a substitute for human reduced-motion or visual acceptance.

Safari remains an explicit QA gap: SafariDriver was available locally and reported ready on 2026-08-26, but `npm run browser:safari:probe` still timed out during WebDriver session creation. The probe defaults to a non-blocking JSON evidence result and supports `SAFARI_REQUIRE_SESSION=1` for a strict gate once the host can create a session. The Chrome matrix and baselines must not be presented as cross-engine evidence.

On 2026-08-26, the clean CI browser matrix also measured every visible map, header,
action-dock, and phase control used by the local smoke at 1280×720, 834×1112,
and 390×844. All measured controls met the 44px minimum target contract. This
is runtime evidence for the development fixture; it does not replace manual
touch, zoom, focus, assistive-technology, or physical-board acceptance.

On 2026-08-26, the post-setup Chrome visual checkpoint was updated after correcting
the match surface: it now contains 261 tile buttons (254 candidate faces plus
nine canonical development overlays), with 252 unresolved shell faces disabled.
The runtime smoke also asserts zero unresolved placeholder nodes and zero visible
unresolved labels on those disabled faces.
The updated hashes are recorded in `docs/browser-visual-baselines.json`. This
proves the visible honeycomb candidate presentation, not physical-board fidelity
or MVP promotion.

On 2026-08-26, a live 1280×720 review found and removed two non-authoritative
gameplay overlays: the decorative board title and the `HOLLYWOOD` region label.
Both could visually cross candidate tile seams. The source contract and local
runtime smoke now fail if either overlay is reintroduced. The home-screen hero
still provides the separate art-led title treatment; the gameplay map is kept
to the candidate faces, authored development pins, pieces, and explicit source
status.

On 2026-08-26, the supported Chrome screenshots were reviewed at desktop,
tablet, and mobile sizes. The mobile review found the compact header's flex rule
could clip the `Open controls` action when the title wrapped; the header now
returns to normal flow below 700px, with the action row below the title. The
local screenshot runner also allocates isolated Vite and Chrome debug ports so
the review cannot silently use a stale development server. The deterministic
Chrome hashes were intentionally regenerated after this visible UI fix. This
remains development-fixture evidence; human visual acceptance and physical
board fidelity remain open.
