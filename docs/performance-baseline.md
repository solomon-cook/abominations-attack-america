# Local browser performance baseline

Captured on 2026-09-28 against the production build in `apps/web/dist`. This is a local lab baseline, not production telemetry and not evidence that a change made the experience faster. The initial three-run raw record is [`output/performance/browser-benchmark-2026-09-28.json`](../output/performance/browser-benchmark-2026-09-28.json).

## Environment and setup

- Host: Mac15,13, Apple M3, 8 cores, 8 GB RAM, macOS 26.5.
- Runtime: Node 24.9.0, npm 11.6.0, Playwright 1.63.0, headless Chrome 140.0.7339.186.
- Driver: [`scripts/verify-browser-performance.mjs`](../scripts/verify-browser-performance.mjs), run as `npm run build && npm run browser:performance:measure -- --runs=3 --output=output/performance/browser-benchmark-2026-09-28.json`.
- Served `apps/web/dist` with Vite preview on loopback and an ephemeral strict port. Build SHA-256: `cdbf73c8cffea434a6df8cbb273b63290e05ffbc4df13487749c3e1d1bd351a6`. The build contained 1,456 files / 143,496,071 bytes; the main JS entry was 736,441 B and CSS entry 262,201 B.
- Each sample used a fresh browser context, disabled the browser cache over CDP, blocked service workers, stubbed the Home API host, and applied 4× CPU throttling and 150 ms RTT / 1.6 Mbps download / 750 Kbps upload. Desktop emulation was 1280×720; phone emulation was 390×844 with touch enabled. The selection scenario uses mouse input on desktop and a touchscreen tap on phone. There were three samples for each scenario and viewport.
- Cold Home samples waited for `load`, the Home heading, hero-image decode, fonts, and an additional 250 ms before reading FCP, the latest LCP candidate observed by that point, and Long Task PerformanceObservers. This is not a formally frozen page-final LCP. The observed LCP element was the Megaclaw image.
- The board interaction scenario used visible setup choices, completed local two-player setup, and selected the nearest visible legal destination after checking its center with `elementFromPoint`. Timing ends when the Confirm move button becomes visible; the command was not committed. The Event Timing entry is scoped to that board selection. Resource totals include same-origin Resource Timing entries that started during setup/selection and completed by the confirmation endpoint; requests still in flight at that point are excluded.

The earlier 2026-09-27 baseline used an inline driver that was not saved. These measurements establish the first reproducible baseline for the checked-in driver; differences from the earlier figures are not before/after evidence.

## Cold Home navigation

Times are milliseconds. Ranges show all three runs. Long Task totals are summed per run.

| Viewport | FCP median (range) | LCP median (range) | Long Task total median (range) | Same-origin transfer per run |
| --- | ---: | ---: | --- | ---: |
| 1280×720 | 1,744 (1,740–1,904) | 1,928 (1,924–2,036) | 105 ms (103–253) | 253,188 B |
| 390×844 | 1,736 (1,732–1,756) | 1,936 (1,932–1,936) | 101 ms (99–102) | 253,188 B |

Same-origin transfer per run was 184,766 B JS, 49,347 B CSS, and 19,075 B images, excluding the navigation document. Desktop run one had a Long Task total outlier. These metrics do not isolate a cause.

## First board selection after setup

Terrain requests were still arriving during setup and selection. This is a first-selection baseline, not steady-state pan/zoom performance. Event Timing duration includes the input delay and handler duration below.

| Viewport and input | Event Timing duration (median, range) | Input delay median | Handler processing median | Input to Confirm visible (median, range) |
| --- | ---: | ---: | ---: | ---: |
| 1280×720 · mouse | 160 ms (160–184) | 77.6 ms | 17.3 ms | 175.3 ms (171.4–230.8) |
| 390×844 · touchscreen tap | 192 ms (184–208) | 97.0 ms | 19.5 ms | 230.1 ms (224.1–253.7) |

Same-origin Resource Timing entries started during setup/selection and completed by confirmation ranged from 4–5 per desktop sample (50,511–51,329 B) and 4–6 per phone sample (51,333–52,131 B). Entries still loading when Confirm appeared were not included. This is a first-selection measurement, not a complete terrain inventory or steady-state pan/zoom result.

## Earlier seven-run snapshot

Captured after rebuilding the current worktree on 2026-09-28. The raw record is [`output/performance/browser-benchmark-2026-09-28-seven-run.json`](../output/performance/browser-benchmark-2026-09-28-seven-run.json); build SHA-256 `e3bf7ea2d1a37dcd41925468dc637b07661abbef4eac26a54defa182a987198f`. It contains 28 samples: seven for each scenario at each viewport. The protocol, throttling, browser, readiness point, and selection endpoint match the initial driver description above.

| Scenario | Viewport | Median (range) | Additional measurements |
| --- | --- | --- | --- |
| Cold Home | 1280×720 | FCP 1,744 ms (1,736–1,940); LCP candidate 1,936 ms (1,924–2,040); long-task total 101 ms (98–337) | 253,364 B same-origin transfer per run: 184,942 B JS, 49,347 B CSS, 19,075 B images |
| Cold Home | 390×844 | FCP 1,756 ms (1,736–1,776); LCP candidate 1,940 ms (1,936–1,956); long-task total 102 ms (99–109) | Same 253,364 B transfer breakdown |
| First legal selection | 1280×720, mouse | Input to Confirm 177.3 ms (173.6–185.4) | Click Event Timing 160 ms (152–168): 79.8 ms median input delay, 17.6 ms processing; median completed same-origin resources 50,599 B |
| First legal selection | 390×844, touchscreen | Input to Confirm 223 ms (213–262) | Click Event Timing 184 ms (168–208): 99.7 ms median input delay, 17.8 ms processing; median completed same-origin resources 52,020 B |

These results are a more stable current-build reference, not a before/after comparison. The browser flow still measures the first selection while terrain requests may be in flight; it does not characterize steady-state pan/zoom or attribute input delay to a specific cause. The build has a 737,465 B main JS entry and a 262,201 B CSS entry; its main chunk remains above Vite's 500 kB warning threshold.

## Overhaul audit snapshot and Home import attribution

Captured after rebuilding the exact current worktree on 2026-09-28. The seven-run record is [`output/performance/browser-benchmark-2026-09-28-overhaul-audit-baseline.json`](../output/performance/browser-benchmark-2026-09-28-overhaul-audit-baseline.json), with 28 samples (seven per scenario and viewport) and build SHA-256 `062d16b7bab2e7452a07e852d38ab28150baa137487d38d3bf75fb847899d6a8`. The source-map module inventory is [`output/performance/bundle-attribution-2026-09-28.json`](../output/performance/bundle-attribution-2026-09-28.json). It was generated from a temporary source-map build whose main JavaScript matched the measured build after removing only the appended source-map comment; no source map was added to the production assets.

| Scenario | Viewport | Median (range) | Additional measurements |
| --- | --- | --- | --- |
| Cold Home | 1280×720 | FCP 1,768 ms (1,748–2,052); LCP candidate 1,948 ms (1,932–2,132); long-task total 105 ms (102–484) | 254,701 B same-origin transfer per run: 186,211 B JS, 49,415 B CSS, 19,075 B images |
| Cold Home | 390×844 | FCP 1,784 ms (1,752–1,828); LCP candidate 1,960 ms (1,940–2,000); long-task total 110 ms (101–198) | Same 254,701 B transfer breakdown |
| First legal selection | 1280×720, mouse | Input to Confirm 177.9 ms (168.8–194.3) | Completed same-origin resources median 51,307 B |
| First legal selection | 390×844, touchscreen | Input to Confirm 255.5 ms (222.8–293) | Completed same-origin resources median 52,180 B |

The rebuilt application entry is 741,877 B minified and the CSS entry is 262,560 B. Home loads that one application entry; `BoardReview` is the only separate JavaScript chunk. The source map contains 82 modules, including 62 web source files. Among the largest original source files in the entry are `main.tsx` (108,381 B), the game engine index (244,400 B), audited board data (91,795 B), bot logic (56,245 B), `HexGrid.tsx` (27,971 B), and `FightResolutionPanel.tsx` (19,423 B). These are original source-content sizes, not per-module minified or compressed contribution estimates. The raw inventory records all modules and byte counts.

The cold Home branch is returned from the same `App` only after the game state has been initialized and game-derived values have been computed. A narrow lazy import of one or a few visual components would defer only part of that shared work, then add a new uncached request when play begins. A safe Home-to-game import boundary therefore needs controller/state extraction rather than a simple component import edit. No code or artwork was changed for this audit. This is a module-graph finding, not a claim that moving gameplay code has already improved Home speed.

## Home request-state follow-up snapshot

Captured after rebuilding the current stable web app on 2026-09-28. The raw record is [`output/performance/browser-benchmark-2026-09-28-home-request-race-fix-seven-run.json`](../output/performance/browser-benchmark-2026-09-28-home-request-race-fix-seven-run.json): 28 samples using the same checked-in seven-run protocol, viewports, throttling, cold-context behavior, and first-selection endpoint as the preceding snapshot. Its build SHA-256 is `93a66846a57814827091fbcf66bdfc667e117ef4cf4a790f01685e32a2f205b0`. Exact entry SHA-256 and the current 82-module source inventory are in [`output/performance/bundle-attribution-2026-09-28-home-request-race-fix.json`](../output/performance/bundle-attribution-2026-09-28-home-request-race-fix.json).

| Measurement | Previous seven-run median (range) | Current seven-run median (range) | Median difference |
| --- | ---: | ---: | ---: |
| Cold Home FCP · 1280×720 | 1,768 ms (1,748–2,052) | 1,780 ms (1,752–1,964) | +12 ms |
| Cold Home LCP candidate · 1280×720 | 1,948 ms (1,932–2,132) | 1,964 ms (1,936–2,064) | +16 ms |
| Cold Home long-task total · 1280×720 | 105 ms (102–484) | 110 ms (101–365) | +5 ms |
| Cold Home FCP · 390×844 | 1,784 ms (1,752–1,828) | 1,776 ms (1,756–1,796) | −8 ms |
| Cold Home LCP candidate · 390×844 | 1,960 ms (1,940–2,000) | 1,960 ms (1,940–1,968) | 0 ms |
| Cold Home long-task total · 390×844 | 110 ms (101–198) | 106 ms (100–166) | −4 ms |
| First selection to Confirm · 1280×720 | 177.9 ms (168.8–194.3) | 185.1 ms (165–201.7) | +7.2 ms |
| First selection to Confirm · 390×844 | 255.5 ms (222.8–293) | 262.4 ms (221.8–331.3) | +6.9 ms |

The emitted main entry grew from 741,877 B to 742,929 B (+1,052 B, +0.14%); the same Node gzip measurement grew from 185,911 B to 186,182 B (+271 B). CSS remained 262,560 B. Cold Home transfer rose by the same 271 B in JS (186,211 B to 186,482 B), with CSS at 49,415 B and images at 19,075 B in both snapshots. The main entry hash is `dda06c168bac0c8a7ae7172ac7020dbf0cfa0ea8bfd22fda7078919001860e49`.

The source-map inventory still has 82 modules (62 web source files), with `BoardReview` as the separate JavaScript chunk. Original source-content sizes changed in `HomeScreen.tsx` (+229 B), `LobbyPanel.tsx` (+1,299 B), and `main.tsx` (+1,395 B); these are source bytes, not emitted byte attribution. Browser median differences are small and all timing ranges overlap. One current phone first-selection sample counted three additional monster portrait requests and had 369,696 B of completed same-origin resources; the other six phone samples ranged from 52,020 B to 53,201 B. This reflects the driver's setup/selection resource window and is reported as measurement variance, not a change in graphics quality or a cause for the timing differences. Treat this section as a comparable snapshot, not evidence that the Home request-state/race fix caused a speed change. No code or artwork was changed for this capture.

## Earlier Chrome DevTools trace audit

Captured four actual Chrome DevTools Protocol traces from the production preview on 2026-09-28: cold Home and the first legal selection at 1280×720 and 390×844. The app build hash is `93a66846a57814827091fbcf66bdfc667e117ef4cf4a790f01685e32a2f205b0`; the main JS entry (`assets/index-CHyFpp1r.js`, 742,929 B) has SHA-256 `dda06c168bac0c8a7ae7172ac7020dbf0cfa0ea8bfd22fda7078919001860e49`. The capture driver is [`scripts/capture-browser-performance-trace.mjs`](../scripts/capture-browser-performance-trace.mjs), and its command was `node scripts/capture-browser-performance-trace.mjs --output-prefix=output/performance/chrome-trace-2026-09-28`. [`output/performance/chrome-trace-2026-09-28-summary.json`](../output/performance/chrome-trace-2026-09-28-summary.json) records the build, event counts, compressed and raw hashes, phase marks, and summarized trace events.

| Capture | Viewport | Measured interval | Renderer main-thread `RunTask` spans ≥50 ms |
| --- | --- | --- | --- |
| Cold Home | 1280×720 | document-start to Home-ready: 2,073.6 ms | 165.5 ms, 53.4 ms, 116.1 ms |
| Cold Home | 390×844 | document-start to Home-ready: 2,022.1 ms | 123.5 ms, 89.4 ms |
| First legal selection | 1280×720 | tap/click to Confirm visible: 183.1 ms | One 124.7 ms span began 0.5 ms after input |
| First legal selection | 390×844 | tap/click to Confirm visible: 287.9 ms | One 143.4 ms span began 44.4 ms after input |

The trace places a `v8.evaluateModule` event of 159.9 ms inside the desktop Home's longest main-thread task; the corresponding phone event was 120.0 ms. Main-thread V8 `V8.ParseProgram` event durations summed to 44.7 ms desktop and 43.1 ms phone; `V8.CompileCode` summed to 53.1 ms and 56.5 ms. These event totals can overlap one another and the enclosing task. A separate `v8.parseOnBackground` span was about 1,155–1,158 ms on a worker thread, so it is not main-thread CPU time and should not be added to the main-thread totals. During the first selection interval, summed `v8.callFunction` durations were 128.3 ms desktop and 160.0 ms phone; these nested event durations also overlap and do not identify one function as the cause.

Chrome's network events recorded the main JS request as 742,929 decoded bytes / 186,689 encoded bytes, with a 1,353 ms request-to-finish span in the desktop Home trace. CSS was 262,560 decoded / 49,506 encoded bytes over 657 ms. The Home hero request, `/assets/monsters/megaclaw.webp`, returned 18,050 decoded / 18,318 encoded bytes over 247 ms. `Decode Image` recorded two WebP worker-thread events (0.3 ms and 1.3 ms desktop; 0.1 ms and 1.3 ms phone). The decode event data exposes image type and internal IDs, not the source URL, so those events cannot be conclusively assigned to the Megaclaw request. During the phone's first-selection interval, three monster portrait requests begun during setup completed near the click-to-confirm window; the corresponding trace also records a 2.4 ms WebP decode on a worker. That overlap is observable activity, not proof it delayed the input.

The four compressed Chrome trace files are [`Home desktop`](../output/performance/chrome-trace-2026-09-28-home-1280x720.json.gz), [`first selection desktop`](../output/performance/chrome-trace-2026-09-28-first-selection-1280x720.json.gz), [`Home phone`](../output/performance/chrome-trace-2026-09-28-home-390x844.json.gz), and [`first selection phone`](../output/performance/chrome-trace-2026-09-28-first-selection-390x844.json.gz). Each is a standard Chrome trace JSON stream compressed with gzip and can be decompressed before loading into Chrome's Performance trace viewer. The raw files contain about 42,000 events per Home trace and 130,000–149,000 events per setup-and-selection trace.

Capture conditions match the browser benchmark: fresh contexts, disabled HTTP cache, blocked service workers, 4× CPU throttling, and 150 ms RTT / 1.6 Mbps download / 750 Kbps upload. The browser was headless Chrome 140.0.7339.186 on the local Mac M3 host. The page's Home API calls were fulfilled with local deterministic fixtures; static production assets were served unchanged, and no artwork was intercepted or edited. These are one trace per scenario and viewport, so they show sampled main-thread events and concurrent work, not stable medians. The task/event nesting identifies module evaluation and input-window work as places for a repeated profile, but it does not establish a single causal hotspot. API, database, GPU frame-rate, and deployed-network performance were not measured here.

## Resumed overhaul seven-run snapshot and traces

Captured after rebuilding the current worktree on 2026-09-28. The seven-run record is [`output/performance/browser-benchmark-2026-09-28-resumed-overhaul-seven-run.json`](../output/performance/browser-benchmark-2026-09-28-resumed-overhaul-seven-run.json), with build SHA-256 `c15ade6171307a76bd486a7ccf20155c2aa081c16d385616b7f739aa67d9f98f`. The production entry is 744,564 B and CSS is 262,856 B. Browser Resource Timing records an `encodedBodySize` of 186,754 B for the JS entry. The comparator is the earlier [`home-request-race-fix` seven-run record](../output/performance/browser-benchmark-2026-09-28-home-request-race-fix-seven-run.json), build SHA-256 `93a66846a57814827091fbcf66bdfc667e117ef4cf4a790f01685e32a2f205b0`, with a 742,929 B entry and 186,182 B encoded body. Production images and rendering resources were served without interception or transformation during each capture; this does not claim byte or pixel equivalence across builds.

| Scenario | Viewport | Median (range) | Additional measurements |
| --- | --- | --- | --- |
| Cold Home | 1280×720 | FCP 1,968 ms (1,948–2,228); LCP candidate 2,080 ms (2,068–2,312); long-task total 343 ms (337–624) | 255,578 B same-origin transfer: 187,054 B JS, 49,449 B CSS, 19,075 B images |
| Cold Home | 390×844 | FCP 1,980 ms (1,956–2,480); LCP candidate 2,092 ms (2,072–2,528); long-task total 348 ms (338–842) | Same transfer breakdown |
| First legal selection | 1280×720, mouse | Input to Confirm 369.8 ms (346.8–410.4) | Click Event Timing 304 ms median (280–320): 154.5 ms input delay, 39.9 ms processing; median completed setup/selection resource window 658,562 B |
| First legal selection | 390×844, touchscreen | Input to Confirm 458.4 ms (411.7–547.8) | Click Event Timing 328 ms median (304–352): 172 ms input delay, 38.7 ms processing; median completed setup/selection resource window 786,368 B |

This uses the same seven-run protocol as the `home-request-race-fix` snapshot, but the current medians are higher: desktop/phone Home FCP is +188/+204 ms, LCP candidate +116/+132 ms, and long-task total +233/+242 ms; first-selection medians are about 2.0×/1.75×. Treat this as a concerning signal for investigation, not a confirmed regression or causal comparison: these are different builds and capture times, and host-load telemetry and randomized run order were not recorded. The setup/selection resource metric counts same-origin entries started at or after the setup-start marker and completed by Confirm. It excludes the initial document and Home assets fetched before that marker, and omits requests still in flight. It includes large board and portrait requests when they meet those conditions; it is not total first-match transfer, and the higher byte count does not show that images caused the timing change.

Four current-build Chrome DevTools traces are saved under the `resumed-overhaul` prefix: the [summary](../output/performance/chrome-trace-2026-09-28-resumed-overhaul-summary.json), [Home desktop](../output/performance/chrome-trace-2026-09-28-resumed-overhaul-home-1280x720.json.gz), [first selection desktop](../output/performance/chrome-trace-2026-09-28-resumed-overhaul-first-selection-1280x720.json.gz), [Home phone](../output/performance/chrome-trace-2026-09-28-resumed-overhaul-home-390x844.json.gz), and [first selection phone](../output/performance/chrome-trace-2026-09-28-resumed-overhaul-first-selection-390x844.json.gz). They were captured with the same Chrome build, CPU/network throttling, and fresh contexts; each capture served its production assets without interception or transformation.

The two desktop Home traces differ: the Home-only capture took 2,818 ms from document start to Home-ready and had four ≥50 ms main-thread tasks totaling 1,005 ms; the first-selection trace's Home phase took 2,141 ms and had three tasks totaling 379 ms. The Home-only desktop capture is an outlier, with a 532 ms frame that includes about 399 ms of `UpdateLayoutTree` and an adjacent module-evaluation task of about 272 ms. The two phone Home phases took 2,134–2,136 ms and had three ≥50 ms tasks totaling 355–358 ms. Main JavaScript fetches were about 1.35 seconds in the traces (744,564 decoded B / about 187 kB transferred); CSS fetches were 0.65–0.67 seconds (262,856 decoded B / about 49 kB transferred), and the 18,050 B Megaclaw image fetch was 0.25–0.58 seconds. Background parse and image decode work is recorded on worker threads and is not main-thread CPU time.

The 2-player local setup trace phase took 5,238 ms desktop and 5,142 ms phone. Each had 15 main-thread tasks of at least 50 ms, totaling 3,527 ms and 3,073 ms respectively. The largest task was 1,033 ms desktop and 568 ms phone. A one-off source-map inspection used `npm --workspace @abominations/web run build -- --sourcemap --outDir=/tmp/aaa-overhaul-sourcemap`; the generated JavaScript matched the captured entry byte-for-byte after stripping the appended map comment. The largest anonymous `FunctionCall` event's single minified location (line 8, column 123363) mapped to the function expression inside React's `scheduleImmediateRootScheduleTask` in `react-dom-client.production.js`. The temporary map was not retained; this call-site mapping does not identify an application component or show whether board validation, rendering, or another state update dominates the whole task. One full-document `Layout` event covered roughly 3,630 objects for 426 ms desktop and 3,615 objects for 110 ms phone. This phase begins before the “Start local game” click and ends after the driver selects up to 18 visible setup choices, serializing the full panel and waiting for a changed DOM signature after each choice. Its wall time therefore includes browser-automation cadence and must not be treated as one application operation or user setup time. The long main-thread tasks and layouts remain a prioritization signal; initializer work, component rendering, and choice updates are source-based candidates, not trace-attributed causes.

The separate first-legal-selection trace took 366 ms desktop and 479 ms phone, close to the seven-run medians. Both contain two ≥50 ms main-thread tasks (232 + 74 ms desktop; 247 + 54 ms phone). Their trace events show app-bundle execution plus repeated style recalculation; summed `UpdateLayoutTree` event durations are about 139/155 ms and overlap with enclosing work. The traces have no JavaScript sampling stacks to identify an exact function, and nested task, script, rendering, raster, and image events are not additive CPU totals. No graphics should be reduced based on these measurements. A source-mapped V8 profile now separates cold Home, setup choices, and first selection; see the sampled-profile section below. It is one capture per scenario and viewport, so it supports attribution only. To assess user-visible impact, compare at least seven matched unprofiled runs and same-state visuals before accepting a performance claim.

## Bot route-scoring optimization

The bounded all-bot harness exposed a separate engine CPU hotspot in `routeBlockScores`: it repeated a full-board breadth-first search for each rival/objective pair. The implementation now builds/caches movement-legal outgoing neighbors in board-edge order, runs one BFS tree per rival, and reconstructs each objective's first shortest path from that tree. This keeps movement gates and tie ordering while removing repeated searches.

Two seed-0, one-round runs were captured before the change (one earlier run was 54.48 s overall with about 39.26 s sampled route-scoring CPU; a separate measured run was 50.10 s overall with 37.27 s sampled route-scoring CPU). Two matching runs after the change took 12.35 s and 12.38 s overall; sampled route-scoring CPU was 30.04 ms and 27.50 ms. Each run made 41 route-score calls across the 3- and 4-seat matches. The second pre-change baseline vs first post-change run is a 75% reduction in simulation wall time and about a 1,240× reduction in sampled route-scoring CPU. CPU figures are approximate V8 inclusive samples at a 1,000 μs profiler interval; wall time includes all simulation work.

The match results stayed the same in both before/after seed-0 samples: 31/39 total actions, 3/4 turns, 3/4 stomped objectives, the same per-seat tactic/Health/Infamy values, and zero invalid actions. Both reached the one-round cap with no winner. `bots.test.ts` compares the optimized `Map` entries and insertion order against the previous per-goal search over rival objectives on the transcribed board; that oracle already omits the bot's own monster, matching the separately intended self-threat scoring correction. It demonstrates traversal parity for rival targets, not equality with the unmodified legacy score map. A movement-neighbor test checks the indexed graph against `movementPathAllowed` across both board definitions and all four monster movement modes. This is performance evidence for a capped deterministic sample, not strategy-quality evidence.

The bot timings above are preserved as a written summary, but per-run output, profiler recordings, and baseline/current revision identifiers were not saved as raw artifacts. Treat them as preliminary optimization evidence, not a durable benchmark record. Future comparisons should retain the driver's raw stdout or structured output, profiler artifacts where available, revision identifiers, and the same deterministic match summary.

## Limits and follow-up

- This is a throttled local preview. It does not represent deployed network, API, database, or device performance.
- No presented-frame rate, compositor/GPU timing, or validated React render-cause duration trace was collected. The camera follow-up below records pan/zoom events and React commit-root callbacks, but it is one instrumented capture per viewport; fiber walking can perturb the gesture, and the overlapping trace events do not establish a component-level timing cause.
- Historical raw main-entry measurements range from 736.44 kB initially to 737.46 kB at the earlier seven-run build and 741.87 kB at the overhaul audit snapshot. The comparable `home-request-race-fix` and resumed-overhaul records show raw entries of 742,929 B and 744,564 B, with Resource Timing `encodedBodySize` values of 186,182 B and 186,754 B respectively. Vite's displayed gzip estimates are not recorded in these benchmark artifacts and are not used in this comparison. The separate BoardReview chunk is 5,241 B raw in the current build; its compressed size is not part of the Home benchmark. The >500 kB warning remains. These are lab measurements, not a before/after improvement claim.
- Source artwork under `apps/web/public` and `apps/web/src/assets` is unchanged. Refreshed `output/board-art/*.png` captures show different match states, so they are not same-state pixel comparisons and do not establish visual equivalence. Future layout/performance comparisons should capture the same scenario and viewport while checking that the existing artwork remains intact.
- Existing terrain artwork uses lazy loading and adaptive 256/512/1024 WebP variants. Preserve those assets and current graphics while profiling; do not reduce art to improve a transfer metric.
- The source-map inventory and current shared Home/game initialization are documented above; a narrow component-only lazy boundary would add a gameplay request without removing the shared controller/engine from Home. A safe Home-to-game extraction would require a larger controller/state boundary and a matched seven-run measurement before it is accepted. The phone selection trace contains a 143.4 ms main-thread task beginning 44.4 ms after input, but this single sample does not establish why Event Timing reported its input delay or which component was involved; repeated traces and a React render profile are still needed for that attribution.
- The bot benchmark driver is checked in at `scripts/verify-bot-strategy-batch.tsx`. The browser driver writes raw JSON after each sample and records the build hash. Three repetitions recreate the prior sample count but are too few to support small-win claims; use at least seven repetitions for comparisons, inspect traces for the proposed cause, and compare screenshots/rendering quality.

## Matched adjacency-cache browser comparison

Captured on 2026-09-28 using two disposable copies of the same current source and dependency snapshot. The cached copy contains the checked-in adjacency optimization. In the baseline copy, only the graph/path lookup call paths were restored to their prior uncached traversal, including the bot consumer; the remaining files, package lock, production assets, benchmark driver, and dependencies were held constant. The only source differences were `packages/game-engine/src/index.ts`, `packages/game-engine/src/bots.ts`, and the optimization-specific test in `packages/game-engine/src/index.test.ts`. The shared worktree's product files were not changed for this comparison.

The cached/baseline source-tree digests were `c15bcee032f34a4e3ca678cadce6951ec3cb078400b92c79305dc0c9d569e37b` and `95701fe157a6244704ae60ffabf283571e7bce1b4a40edcd95858c21a8a98973`; both copies used package-lock SHA-256 `d172b0e852e9dec338bc713c0bd4d66ba3e1fafb683e4d7df371656234434086`. Their production build hashes were cached `8919e8651afe8d80ef00e6f1d58bc4690b63add4cab48372bc49c8f0f67b2228` and baseline `012644a37d6751d46c4ba0d535a481a49fb265a632df02ae1c5300504bdb1ab2`. The main JavaScript entries were 747,515 B cached and 747,466 B baseline (+49 B); CSS was 263,117 B in each. No graphics or image assets were changed or transformed.

The checked-in production-preview benchmark ran seven samples per variant, alternating variant order across seven pairs (AB/BA). It used the same 4× CPU and 150 ms / 1.6 Mbps / 750 Kbps network throttling, fresh browser contexts, 1280×720 and 390×844 viewports, Home readiness point, and first-selection endpoint described above. Each sample is retained as an individual raw JSON record under [`output/performance/adjacency-ab-2026-09-28/`](../output/performance/adjacency-ab-2026-09-28/); the same folder has each variant's audited-board visual report and screenshots.

Times are milliseconds; delta is cached minus baseline. Ranges include all seven samples.

| Measurement | Baseline median (range) | Cached median (range) | Median delta |
| --- | ---: | ---: | ---: |
| Home FCP · 1280×720 | 1,976 (1,956–2,032) | 1,972 (1,948–2,184) | −4 |
| Home LCP candidate · 1280×720 | 2,096 (2,088–2,132) | 2,100 (2,068–2,268) | +4 |
| Home long-task total · 1280×720 | 338 (326–387) | 331 (321–581) | −7 |
| Home FCP · 390×844 | 2,008 (1,944–2,128) | 1,956 (1,948–1,980) | −52 |
| Home LCP candidate · 390×844 | 2,120 (2,080–2,264) | 2,088 (2,076–2,100) | −32 |
| Home long-task total · 390×844 | 382 (318–489) | 323 (316–348) | −59 |
| First selection to Confirm · 1280×720 | 341.6 (315–502) | 330.7 (306.6–388) | −10.9 |
| First selection to Confirm · 390×844 | 448.6 (424.6–502.7) | 441.6 (408.1–537.7) | −7.0 |

All compared timing ranges overlap. The selected destination was identical across every sample in each viewport (desktop `7,5`; phone `6,2`). The medians are close and this seven-pair browser sample does not establish a reliable user-visible speedup. Home transfer was 256,405 B baseline and 256,446 B cached (+41 B); this small bundle/transfer change is not an image reduction. Setup/selection resource totals varied with requests still in flight and are not interpreted as a transfer improvement.

For graphics evidence, [`baseline-1280x720.png`](../output/performance/adjacency-ab-2026-09-28/baseline-1280x720.png), [`cached-1280x720.png`](../output/performance/adjacency-ab-2026-09-28/cached-1280x720.png), [`baseline-390x844.png`](../output/performance/adjacency-ab-2026-09-28/baseline-390x844.png), and [`cached-390x844.png`](../output/performance/adjacency-ab-2026-09-28/cached-390x844.png) were captured by `scripts/verify-browser-audited-board.mjs`. Both variants passed its scripted board checks at both viewports, with no runtime errors or broken images. On those route screenshots, dimensions matched; per-channel pixel comparison had maximum difference 3 / mean absolute difference 0.0833 at desktop and maximum 2 / mean absolute difference 0.0166 on phone. These figures only describe the captured audited-board route and do not assert whole-site visual parity. The separately run `scripts/verify-browser-local.mjs` stopped at the same PhaseActions focus assertion in both variants; that shared assertion is not used as a passing visual result or evidence of a difference between variants.

This comparison evaluates the browser-level consequence of the adjacency lookup change, not the engine microbenchmark or bot-strategy quality. Preserve existing graphics and assets; do not infer a speed gain from these close, overlapping browser measurements.

## Sampled JavaScript stacks and movement graph profile

Captured on 2026-09-28 with `npm run browser:performance:profile`, implemented by [`scripts/profile-browser-performance.mjs`](../scripts/profile-browser-performance.mjs). The retained raw V8 profiles and summary are [`browser-cpu-profile-2026-09-28.json`](../output/performance/browser-cpu-profile-2026-09-28.json) and its compressed copy. The driver separately samples cold Home, eight real setup choices, and first legal board selection at 1280×720 and 390×844, using fresh pages, 4× CPU throttling, and the same 150 ms / 1.6 Mbps network profile. The sourcemapped temporary build's main JavaScript matched the production-preview entry byte-for-byte after removing only the appended source-map comment (747,515 B in both; build SHA-256 `8919e8651afe8d80ef00e6f1d58bc4690b63add4cab48372bc49c8f0f67b2228`). Source maps were temporary and are not included in the production assets.

The earlier one-run setup profiles are retained in [`browser-cpu-profile-before-board-index-cache-2026-09-28.json`](../output/performance/browser-cpu-profile-before-board-index-cache-2026-09-28.json). In that capture, the repeated `monsterMovementPathAllowed` edge scan sampled 332.63 ms desktop / 322.92 ms phone, `buildBoardIndex` sampled 299.83 / 302.34 ms, and a separate per-edge scan in `index.ts` sampled 219.96 / 228.54 ms. In the current source-mapped profile, those repeated edge-scan call sites no longer appear among sampled setup frames, and the `board.ts` frame at `buildBoardIndex` samples 18.50 / 27.50 ms. `legalMovementNeighbors` now caches movement-filtered outgoing edges by immutable board object, movement mode, and barrier-crossing mode; path enumeration, validation, submarine reachability, and route scoring use that shared edge-order-preserving adjacency.

These are two individual sampled profiles from different worktree revisions, not a controlled timing comparison. V8 sample time is approximate, setup includes browser-driven clicks, focus changes, DOM waits, and rendering, and other code changed between captures. The profiles identify that the targeted repeated scans are reduced in the current call paths; they do not establish a user-visible speedup, overall setup improvement, or visual equivalence. Engine tests compare cached adjacency against the board-edge reference filter for every hex, movement mode, barrier-crossing setting, and the four checked-in board definitions. The current build emits a 747,515 B main JavaScript entry and 263,117 B CSS entry. The matched unprofiled seven-run comparison and same-route screenshot checks are now recorded in [the adjacency-cache comparison above](#matched-adjacency-cache-browser-comparison). Those results show overlapping ranges and do not establish a user-visible speedup; the additional pan/zoom traces below are now available, but do not establish one either.

## Warm board camera trace and nearby subscription trial

Captured on 2026-09-28 using [`scripts/capture-browser-performance-trace.mjs`](../scripts/capture-browser-performance-trace.mjs) with `npm run browser:performance:trace -- --scenario=camera --output-prefix=...`. The production preview completed local setup, waited until every currently visible terrain image was decoded at zoom 1.55, then sent a 20-step drag and a desktop wheel or phone pinch gesture to zoom 4. Desktop uses 1280×720 / DPR 1 and phone uses 390×844 / DPR 2. Each fresh browser context disables cache and uses headless Chrome 140, 4× CPU throttling, and 150 ms RTT / 1.6 Mbps down / 750 Kbps up. The drag and zoom phase durations varied substantially under browser automation; they are recorded in the raw traces and should not be read as fixed 320 ms user gestures.

The two original-component captures use build SHA-256 `d1acc140cdc61a442107e4e5ca776c5fde81c78f7566e8092085dcaa0bf2355d`: [first baseline](../output/performance/board-camera-warm-before-2026-09-28-summary.json) and [repeat](../output/performance/board-camera-warm-before2-2026-09-28-summary.json). The three candidate captures use build SHA-256 `821392e31ce755f7df3b07085677d3bb1d5d60499707f15520963032334371b1`: [candidate run 1](../output/performance/board-camera-warm-after1-2026-09-28-summary.json), [run 2](../output/performance/board-camera-warm-after2-2026-09-28-summary.json), and [run 3](../output/performance/board-camera-warm-after3-2026-09-28-summary.json). Between those builds, only `BoardTerrain.tsx` changed: every terrain cell previously received each camera-resolution state update; the candidate subscribes only cells currently inside the existing 300 px nearby margin and reads the latest requested resolution when a cell becomes nearby. The JS entry grew 91 B and the CSS, image sources, and artwork assets were unchanged.

Times below are the sampled range across two baseline runs and three candidate runs, not paired medians. Each interval includes Chrome trace events between the camera input phase markers. The frame column is the range of `DrawFrame` intervals; these traces contain no `FramePresented` markers, so it is not a reliable FPS or presented-frame metric.

| Viewport / gesture | ≥50 ms task count, baseline → candidate | Task duration total, baseline → candidate | `DrawFrame` p95 interval, baseline → candidate |
| --- | ---: | ---: | ---: |
| Desktop drag | 1–2 → 1–5 | 66–137 ms → 81–407 ms | — |
| Desktop wheel zoom | 7 → 7–10 | 720–923 ms → 960–1,678 ms | 134–190 ms → 188–353 ms |
| Phone drag | 1–3 → 1–2 | 91–385 ms → 70–185 ms | — |
| Phone pinch zoom | 13 → 11–13 | 1,667–1,967 ms → 1,321–1,810 ms | 207–220 ms → 148–207 ms |

The browser captures consistently began with 127/127 visible desktop and 70/70 visible phone terrain images decoded. A separate candidate run with the count added to its trace record found 336 rendered terrain images total at zoom 4, with 46 desktop and 45 phone image bounds intersecting the viewport extended by 300 px; this estimates the candidate's nearby subscriber set at about 14% of all terrain cells for those camera positions. It is a structural callback-count proxy, not a React commit count or elapsed-time improvement. `terrainSourceMutations` was 187 in both baseline desktop runs and 109 in both baseline phone runs; the candidate varied from 137–187 desktop and was 109 in every phone run. Thus the DOM-source proxy does not establish a stable reduction.

The phone zoom timing ranges suggest a possible improvement, while desktop zoom totals are higher in the candidate captures. The runs were not randomized or paired, their event intervals and image decode completion varied, and the results move both ways. The original camera trace waited for only one visible high-resolution image and did not establish full-resolution pixel parity. The follow-up below supersedes that part of the evidence by waiting for every visible tile at its requested source resolution and retaining the exact decoded DOM nodes, but does not compare those screenshots with a matched pre-change image. Keep the nearby-only subscription change as a structural reduction in potential offscreen state notifications, but do not claim a measured user-visible speedup. A lower-overhead React render-duration profile and matched before/after camera captures remain necessary for a frame-time claim. Existing 256/512/1024 source selection and graphics remain intact.

### React commit and full-quality tile checkpoint

The trace driver now records React commit-root callbacks during the camera gestures and waits for the full visible tile set to reach the resolution requested by the existing `TerrainArt` camera policy. It calls `HTMLImageElement.decode()` for every visible tile, retains those exact image-node references, requires the same visible nodes and source set to remain stable for 300 ms, then takes the post-decode checkpoint after two animation frames. This closes the earlier gap where one upgraded image could satisfy the wait while other visible tiles were still at 256 px.

The single desktop and phone captures are [`output/performance/board-camera-react-profile-2026-09-28-summary.json`](../output/performance/board-camera-react-profile-2026-09-28-summary.json), with the compressed raw traces for [desktop](../output/performance/board-camera-react-profile-2026-09-28-camera-1280x720.json.gz) and [phone](../output/performance/board-camera-react-profile-2026-09-28-camera-390x844.json.gz). They used production build SHA-256 `ac9ec4a16c06951c97e399abd3a50a66f424e53443b129d53119f757935debbf`, Chrome 140.0.7339.186, 4× CPU throttling, 150 ms RTT / 1.6 Mbps download / 750 Kbps upload, with no image interception or transformation.

| Viewport | Zoom | Visible terrain | Requested variant | Same-node decode confirmation | React commit-root callbacks |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280×720 · DPR 1 | 1.55 → 4 | 20/20 visible | 1024 px | 20/20; source set stable after decode and two animation frames | 39 total: 24 during pan, 15 during zoom |
| 390×844 · DPR 2 | 1.55 → 4 | 14/14 visible | 1024 px | 14/14; source set stable after decode and two animation frames | 50 total: 24 during pan, 26 during zoom |

At zoom 4, 46/336 desktop and 45/336 phone terrain elements were within the existing 300 px nearby margin. These single captures establish that the existing highest-resolution variants were requested and decoded for every tile visible at the checkpoint; they do not demonstrate before/after quality parity or a speed gain. The matching same-run board screenshots are [desktop](../output/performance/board-camera-react-profile-2026-09-28-visual-1280x720.png) and [phone](../output/performance/board-camera-react-profile-2026-09-28-visual-390x844.png). No art files, source-selection thresholds, or rendering components were changed for this evidence capture.

The hook observed `onCommitFiberRoot` callbacks from React DOM 19.2.8. It also retains the committed `TerrainArt` fiber count and raw `PerformedWork` / `Update` flag matches using that renderer's bit meanings. Those flags are build-specific and the `PerformedWork` matches are not validated as component render counts; for example, many appear in pan commits. The hook walks the committed fiber tree synchronously and can perturb the gesture itself, so use this capture for commit attribution only. It is not a React Profiler `onRender` duration profile or an uninstrumented latency benchmark. The service-worker API is stubbed in this driver because Playwright's blocked-worker context can resolve registration without a registration object; actual service workers remain blocked for all captures.

## Solo-bot dynamic-import experiment

A build-only probe tested loading `solo-bots` with `import()` when a Solo match starts, with the goal of reducing Home's initial JavaScript. The unmodified production build at HEAD `f23a4cd9e722945d20c0f7cbba355013f0d49c5b` has a 750,246 B main entry (187,938 B gzip level 9). The candidate build has a 760,461 B main entry (191,134 B gzip level 9) and a separate 4,699 B `solo-bots` chunk (2,024 B gzip level 9). Thus Home's entry grew by 10,215 B raw / 3,196 B gzip despite the new deferred chunk. The candidate passed web typecheck and production build, but failed the initial-transfer acceptance gate, so its application change was reverted before browser A/B runs. No browser-speed benefit is claimed. The baseline artifact records its source hashes, and both artifacts record their build entry hashes: [baseline](../output/performance/solo-bot-split-baseline-2026-09-28.json) and [comparison](../output/performance/solo-bot-split-comparison-2026-09-28.json). The next optimization needs a boundary that actually removes code from the Home entry before it merits user-facing latency measurements.

## Built-in board hash initialization comparison

At clean HEAD `3bb334433b0799b8e2508dd3704c7c45c388c3ad`, the four built-in board definitions computed their FNV content identities while their modules initialized. The unchanged-source baseline production build had a 750,246 B JavaScript entry and 263,486 B stylesheet. Its Home Chrome trace sampled the full application module evaluation. The browser profile script was also attempted on the unchanged baseline but failed before saving: in Playwright's blocked-service-worker context, `register()` fulfilled without a registration object. The successful trace driver uses an inert test-only service-worker container while still blocking actual service workers.

The candidate pins the exact identities below at module scope in `board.ts` and `audited-board.ts`. Runtime `boardContentHash` and `validateBoardDefinition` remain available for dynamic definitions and explicit validation. A focused engine test recomputes each built-in hash so data edits cannot silently leave a stale identity.

| Built-in board | Pinned hash |
| --- | --- |
| Development nine-location | `fnv1a:89d56f63` |
| Full honeycomb candidate | `fnv1a:0d0b2c17` |
| Provisional authoritative honeycomb | `fnv1a:747c5a9c` |
| Human-audited North America | `fnv1a:995e83d9` |

The before/after traces used the same production-preview capture script and throttling, with one sequential capture per viewport and variant. These are individual trace results, not randomized repetitions or medians.

| Cold Home metric | Desktop baseline → candidate | Phone baseline → candidate |
| --- | ---: | ---: |
| `v8.evaluateModule` on renderer main thread | 146.1 → 100.2 ms (−45.9 ms) | 103.4 → 67.2 ms (−36.2 ms) |
| First Contentful Paint from trace | 1,929.2 → 1,922.2 ms (−7.1 ms) | 1,788.4 → 1,752.1 ms (−36.3 ms) |
| Largest Contentful Paint candidate from trace | 2,045.9 → 2,005.5 ms (−40.4 ms) | 1,971.8 → 1,935.4 ms (−36.3 ms) |
| Home-ready mark | 2,265.8 → 2,237.9 ms (−27.9 ms) | 2,195.5 → 2,159.5 ms (−36.0 ms) |
| Main-thread long tasks ≥50 ms | 2 / 272.4 ms → 3 / 294.4 ms | 1 / 107.6 ms → 1 / 70.1 ms |

The candidate entry is 750,311 B raw, 65 B larger than baseline; its encoded JS response was 50 B larger. CSS stayed at 263,486 B raw / 49,669 B encoded, and the Megaclaw hero stayed at 18,318 B encoded in both captures. The source edits do not touch game-board geometry, terrain art, CSS, image source selection, or rendering; the requested graphics assets were served unchanged. No screenshot comparison was made for this CPU-only change.

Raw trace summaries and compressed Chrome traces are retained for the [baseline](../output/performance/board-hash-init-baseline-trace-2026-09-29-summary.json) and [candidate](../output/performance/board-hash-init-candidate-trace-2026-09-29-summary.json); the compact metrics, build hashes, asset sizes, trace hashes, and limitations are in [the comparison record](../output/performance/board-hash-init-comparison-2026-09-29.json). The lower module-evaluation events are consistent with removing eager board hashing, but the cold-Home measurements are one run per viewport, the variants were captured sequentially, and desktop long-task count and total increased. These traces do not establish a repeatable user-visible speedup; use an alternating seven-pair unprofiled Home comparison before making that claim. The source-mapped profile driver limitation above also means there is no matched per-function V8 profile for this candidate.

## Next candidate: visible terrain upgrade prioritization

The current `TerrainArt` implementation keeps the 256/512/1024 WebP variants and upgrades nearby cells inside the existing 300 px `IntersectionObserver` margin. A camera trace at zoom 4 found 46 terrain cells inside that margin and 20 actually intersecting the desktop viewport; the phone counts were 45 and 14. In one instrumented desktop capture, all 20 visible 1024 px image requests had Low priority, and the same visible nodes did not reach stable decoded 1024 px sources until 5.58 seconds after the zoom gesture. This is a single instrumented signal, not a stable performance baseline.

The bounded candidate is to prioritize currently visible upgrade requests ahead of nearby offscreen upgrades while preserving every image URL, asset, final resolution, and visual treatment. Compare unchanged baseline and candidate in seven balanced AB/BA camera pairs at 1280×720 DPR 1 and 390×844 DPR 2, using the existing 4× CPU and 150 ms RTT / 1.6 Mbps download profile with fresh cache. Measure gesture-end to every visible requested-resolution image decoded and source-stable; target at least a 15% desktop median reduction and require no phone p90 or first-selection regression above 5%. Record request priorities/bytes, same-node decode and final source, and same-state screenshot/pixel comparison. Include fast pan-follow-in checkpoints at one and two seconds to catch visible low-resolution pop-in, and confirm terrain upgrades do not starve API or interface resources. The single trace does not prove that prioritization will meet these thresholds; do not change the asset policy unless the paired evidence passes.

## Alternating seven-pair board-hash comparison

On 2026-09-29, the new [`verify-browser-performance-ab.mjs`](../scripts/verify-browser-performance-ab.mjs) runner compared two clean production builds from the same worktree. Build A restored only the two built-in board source files from HEAD `3bb334433b0799b8e2508dd3704c7c45c388c3ad`; build B used the candidate's pinned built-in hashes. All other source, including the rest of the UI, was identical. Each build contained 1,456 files. The main JavaScript entry was 750,766 B for A and 750,831 B for B (+65 B); CSS was identical at 263,972 B and all source artwork was served without transformation or resolution changes.

The runner collected seven paired cold Home samples at each viewport (14 pairs, 28 samples total), with seeded balanced AB/BA order, a fresh browser context and disabled cache per sample, 4× CPU throttling, 150 ms RTT and 200,000 B/s download. Home readiness waited for the title, decoded hero image, ready fonts, and 250 ms. The retained raw samples, exact build hashes, resource sizes and paired deltas are in [`board-hash-init-ab-seven-pair-2026-09-29.json`](../output/performance/board-hash-init-ab-seven-pair-2026-09-29.json).

| Viewport | FCP median A → B | Paired median delta | LCP median A → B | Paired median delta | Long-task total median A → B | Paired median delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop 1280×720 | 1,768 → 1,724 ms | −44 ms | 1,960 → 1,920 ms | −48 ms | 102 → 61 ms | −41 ms |
| Phone 390×844 | 1,772 → 1,728 ms | −40 ms | 1,956 → 1,912 ms | −44 ms | 100 → 60 ms | −40 ms |

All 14 paired deltas favored B on these metrics, though one desktop FCP/LCP/long-task pair was a much larger outlier than the others. The consistent median reduction supports a small cold-Home improvement in this local, throttled browser protocol. It does not establish hosted-device impact, complete gameplay responsiveness, or camera/rendering frame-time gains; LCP is the latest candidate observed after the readiness wait rather than a formal final-page LCP. The change preserves full-resolution art and unchanged CSS; the tradeoff is a 65 B larger main bundle. Retain the graphics and repeat this protocol on target devices before making a broader speed claim.
