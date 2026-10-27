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

On 2026-10-08, the baseline verifier first found its expected hashes stale, and
the tablet capture changed on a repeat. The screenshot checkpoint now waits for
visible audited terrain images and document fonts to finish before capturing.
After refreshing the desktop/tablet/mobile hashes, `npm run browser:visual:verify`
passed on a fresh repeat. This confirms deterministic Chrome captures at
1280×720, 834×1112, and 390×844.

## Review findings

- The active match is board-first after setup; the secondary controls remain behind an explicit toggle.
- The action dock is outside the map surface and does not cover rule-bearing cells.
- The local development match clearly labels itself as a nine-space source-gated fixture.
- New local and online MVP matches render the same pinned, human-audited 336-cell board and content hash; the separately labelled read-only board review provides cell-by-cell source inspection.
- The responsive contract covers dynamic viewport sizing, safe areas, touch-target rules, reduced motion, map containment, and compact action controls.
- The audited cell faces use the canonical 4.6% width inside a 4.8% centre-pitch row slot. The source layout contract and Chrome smoke verify the 14×24 board topology, positive same-row gaps, and coordinate-matched terrain-art assignments at desktop, tablet, and mobile sizes; the half-slot alternating-row offset follows the supplied responsive-grid reference while the narrower face preserves visible seams.

## Acceptance boundary

Automated source contracts, build/typecheck, runtime smoke, and audited-board geometry/art assignment checks pass. On 2026-10-11 the project owner accepted the current UI visual review for supported desktop, tablet, and mobile sizes and reported no issues; any later-found visual issue may be raised and this result reopened. This visual acceptance does not establish cross-browser parity, physical touch use, keyboard-only or screen-reader play, zoom/focus, reduced-motion behavior, or WCAG acceptance; those reviews remain open. Separately, the board data and same-scale physical-board visual comparison are signed off, while independent source review remains open.

## Project-owner visual acceptance — 2026-10-11

The project owner asked to treat the UI visual review as passed, reported no
issues, and reserved the option to raise issues later. This accepts the current
visual presentation at the documented desktop, tablet, and mobile targets. It
does not close separate touch, zoom, keyboard, reduced-motion,
screen-reader/WCAG, cross-browser, source-rules, or board-independent-review
gates.

The motion contract is now automated separately: `npm run web-motion:verify` confirms all authored CSS animations are finite, transient path feedback settles to explicit end states, transition durations are bounded, and the reduced-motion media query globally clamps animation and transition duration so presentation can be interrupted without changing authoritative match state. This is implementation evidence, not a substitute for human reduced-motion or visual acceptance.

## Text palette contrast review — 2026-10-08

`npm run web-contrast:verify` now checks 22 text/background pairs: the existing
gameplay pairs, all Mutation/Research/shared card surfaces, and both body text
and statistic labels across every military branch sheet. The sheet values are
read from `physical-sheets.css` each run, so editing a palette also updates the
values checked against WCAG AA.
The expanded check found Army and Giant/X-Fighter statistic-label accents below
the 4.5:1 normal-text threshold (4.17:1 and 4.19:1). Their shared light accent
is now `#fff8d6`, which measures 5.44:1 on Army green and 5.07:1 on the Giant
sheet. The check covers source palette values rather than every composited
rendered state; full visual, contrast, focus, zoom, reduced-motion, and
assistive-technology acceptance remains open. The focused checker and the full
`npm run verify` gate both pass with this CSS-linked palette coverage.

## Focused screenshot review — 2026-10-08

An internal visual pass inspected the current saved Chrome captures at
[`1440×900`](../output/board-art/browser-1440x900.png),
[`390×844`](../output/board-art/browser-390x844.png),
[`844×390`](../output/board-art/browser-844x390.png), and the matched-fit full
board at [`1440×900`](../output/board-art/board-fit-1440x900.png). The desktop
play view keeps the tactical map, turn header, selected-piece tray, and primary
action visible together. The phone capture keeps the current action and board
controls in view while following the active west-coast area; it intentionally
shows a tactical slice rather than the whole continent. The fit capture exposes
the complete authored board for strategic inspection. Review of the landscape
capture found that city-stomp event playback could cover the movement-order
strip. `BoardEventPlayback` now scores candidate positions against visible
critical controls before choosing its placement, and the audited-board browser
harness asserts that playback does not overlap the order strip, action bar, map
controls, player record, opponent rail, or minimap. A fresh seven-viewport run
passed at 320×740, 390×844, 844×390, 768×1024, 1024×768, 1440×900, and
2560×1080. This is automated collision evidence, not the project's human visual
acceptance. The pass did not exercise assistive technology or manual
focus/zoom behavior; owner visual acceptance and independent review remain
open.

That screenshot review also found that the focused portrait view still used
the board's width-limited strategic scale. At 390×844 this left a large unused
band below the playable cells even though the viewport itself was full screen.
`BoardViewport` now raises the focused phone view to a height-aware tactical
scale; the explicit reset remains at strategic fit and still contains all 336
cells. A new `npm run browser:audited:verify` run passed setup, camera/touch,
movement, Encounter, and Deploy at 320×740, 390×844, 844×390, 768×1024,
1024×768, 1440×900, and 2560×1080. The updated phone captures show larger
active-area cells. Human visual and assistive-technology acceptance remain
open.

The 390×844 capture also showed that the compact player control rendered the
active monster name with an ellipsis. The control now gets 18px more width at
phone sizes, with the action dock shifted to keep its controls reachable; at
320px the primary action button is 116px wide and stays above the 44px target
minimum. The browser check compares the rendered monster name with its full
accessible name and selects the longest available monster at 320px. Fresh
setup-to-Deploy runs at 320×740 and 390×844 both passed, loaded all 336 terrain
images, and showed the full name. This closes that defect at these two phone
sizes; remaining viewport-specific visual and human/assistive-technology
acceptance remain open.

Safari remains an explicit QA gap: SafariDriver was available locally and reported ready on 2026-08-26, but `npm run browser:safari:probe` still timed out during WebDriver session creation. The probe defaults to a non-blocking JSON evidence result and supports `SAFARI_REQUIRE_SESSION=1` for a strict gate once the host can create a session. The Chrome matrix and baselines must not be presented as cross-engine evidence.

A repeat probe on 2026-08-26 reported the same boundary (`driverReady: true`,
session creation timeout after 15 seconds). This confirms the gap is WebDriver
session creation on the host, not a failed Chrome or source-contract check.

On 2026-10-07, `npm run browser:safari:probe` confirmed that SafariDriver is
available, but Safari rejected session creation because **Allow remote
automation** is disabled in Safari Settings under Developer. This is an
operator-local browser setting; no Safari page was tested. After enabling it,
rerun the probe, then `npm run browser:safari:verify` before recording Safari
runtime evidence. Chrome and CI cross-engine results do not substitute for this
local Safari check.

On 2026-10-08, `SAFARI_REQUIRE_SESSION=1 npm run browser:safari:verify` again
confirmed that SafariDriver starts, but Safari rejects WebDriver session
creation because remote automation is still disabled; no Safari page was
tested. The local Firefox attempt also could not start because `geckodriver`
is not installed. The browser harness now reports a missing driver as a
structured failure and shuts down its temporary Vite server. Neither outcome
is browser-runtime compatibility evidence; the earlier CI browser jobs and
the pending human cross-engine review remain separate proof.

On 2026-08-26, the clean CI browser matrix also measured every visible map, header,
action-dock, and phase control used by the local smoke at 1280×720, 834×1112,
and 390×844. All measured controls met the 44px minimum target contract. This
is runtime evidence for the development fixture; it does not replace manual
touch, zoom, focus, assistive-technology, or physical-board acceptance.

On 2026-08-26, the post-setup Chrome visual checkpoint was updated after correcting
the match surface: it now contains 261 tile buttons (336 candidate faces plus
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

On 2026-08-26, a live in-app-browser review of `Review full board shell` at the
desktop viewport confirmed 336 separated cream faces in 14 staggered rows, with
flat-top orientation, consistent visible seams, no visible same-column
overlap, and no `Unresolved` labels rendered on the faces. The same review also
confirmed the remaining source-fidelity defect: the shell is a neutral
rectangle, not the physical board's authored coast/sea cut-outs, feature art,
labels, barriers, or off-board boundary. The surface correctly presents this as
read-only review tooling and does not expose it as MVP play.

The follow-up board-review contract checked the optimized full-setup and
top-down reference photographs at 1280 × 720, 834 × 1112, and 390 × 844. Both
images loaded at every viewport, while the 336-face candidate remained
contained, non-playable, and free of unresolved player-facing labels. This is
runtime evidence for the comparison tool only; it does not constitute manual
visual acceptance or physical-board transcription sign-off.

On 2026-10-07, the audited-board browser matrix exposed an interaction overlap
at 844 × 390: the movement-order strip covered the map camera controls and
could also intercept the bottom action dock. The strip now sits below the
header on the right side at short landscape sizes, leaving the left camera
controls and bottom action dock clear. The complete seven-viewport Chrome run
passes setup, camera bounds/zoom/pan/touch/resize, movement, encounter, and
deployment, including this 844 × 390 layout. The wheel remains at the landscape
fit scale in that viewport; touch zoom passes. This is automated Chrome
evidence, not human visual acceptance or cross-browser review.

On 2026-10-07, a board-first gameplay screenshot review found that the movement
order strip shortened unit names to ellipses and omitted each piece's location
and movement state from its accessible name. The strip now wraps full names
over multiple lines, keeps horizontal scrolling for large inventories, and
announces the piece name, location, movement state, and selection state. The
audited-board browser harness checks label wrapping, overflow, and full
accessible names at 320×740, 390×844, and 1440×900. This closes that specific
implementation defect; it does not replace the open human UI acceptance,
assistive-technology, or cross-browser reviews.

On 2026-10-07, a local board-first review found that the desktop movement-order
strip covered too much of the board and sat over the action dock by a few
pixels. The strip is now compact, horizontally scrollable, and checked against
the active action dock. At tablet widths it moves above the open player record;
the browser smoke verifies that it does not cover the record's Map tab or the
overview map. The tablet Map tab now reveals the overview only while the record
is open, and collapsing the record hides it again. The local matrix runner now
passes exactly one requested viewport into each desktop, tablet, and mobile
case instead of repeating its default viewport set. The corrected 1280×720,
834×1112, and 390×844 Chrome matrix passes. These are automated interaction and
layout checks; human visual acceptance, assistive-technology playthrough, and
cross-browser review remain open.

On 2026-10-07, the Chrome screenshot verifier was corrected to pass one requested
viewport into the local browser harness, honor reduced motion, and capture only
after the audited-board setup is complete. The previous hashes were from the
monster-selection screen despite the documented post-setup checkpoint. The
desktop, tablet, and mobile post-setup screenshots were visually reviewed,
the three deterministic hashes were regenerated in
`docs/browser-visual-baselines.json`, and a clean comparison rerun passed. These
screenshots show the 336-cell audited board in a playable view; same-scale
physical-board comparison, human acceptance, accessibility review, and
cross-browser review remain open.

On 2026-10-07, a focused mixed-stack review found that ownership labels were
derived from the active turn, so an online player viewing an opponent's turn
could see the opponent's pieces labelled as their own; spectators also lacked
a stable viewing perspective. The inspector now labels ownership relative to
the authenticated/local viewer and uses explicit `Player N` labels for
spectators. `npm run verify:selected-piece-ui` covers an eight-piece mixed
monster/unit stack while the other player's turn is active, plus spectator
labels; `npm run typecheck:web` passes. This closes the ownership-label defect,
not the remaining dense-gameplay-stack or supported-size human acceptance.

On 2026-10-07, the full seven-size audited-board Chrome run exposed two more
responsive UI defects. At desktop larger-text settings, Albuquerque wrapped
mid-word; the city-label lane now uses more of the cell width and preserves
normal word wrapping, with a browser assertion that a single-word city name
stays on one line. At 320×740, the deployment prompt and Cancel control could
cover legal board targets; deployment guidance and Cancel now sit in the
board-adjacent action dock. The complete 320×740, 390×844, 844×390, 768×1024,
1024×768, 1440×900, and 2560×1080 interaction matrix passes, including legal
deployment and the larger-text assertion. These automated checks close the
specific defects; same-scale physical-board comparison, human visual
acceptance, manual assistive-technology playthrough, and cross-browser review
remain open.

On 2026-10-08, a review of the count-aware stack grid found the last row
left-biased for odd counts. Gameplay and review-fixture layouts now center the
final occupant in 3-, 5-, and 7-piece stacks. The Chrome review contract checks
all 1–8 fixture counts for loaded art, face containment, pairwise non-overlap,
and centered odd tails at 1280×720, 834×1112, and 390×844; the CI browser
matrix passes all three sizes. This closes the odd-row layout defect and adds
automated fixture geometry evidence; full live-gameplay-stack and human visual
acceptance remain open.

The 2026-10-08 three-session online smoke now also measures the live mixed
monster/unit artwork after the accepted-move emphasis settles. It asserts
containment inside the owning hex and zero pairwise artwork overlap at
320×740, 390×844, 844×390, and 768×1024, while retaining the existing visible
inspector, ownership/status details, action-dock clearance, and unchanged-room
revision checks. The run passes; this covers the live two-piece battle stack,
not every eight-piece gameplay arrangement or human acceptance.

The latest 320×740 capture exposed a city-stomp playback card covering the
persistent active-hex context tray. Event playback placement now treats that
tray as an obstruction alongside the fixed HUD, and the seven-size audited-board
browser contract checks for overlap with it. Automated verification closes this
specific mobile overlap; same-scale physical-board comparison, human visual
acceptance, manual assistive-technology playthrough, and cross-browser review
remain open.
