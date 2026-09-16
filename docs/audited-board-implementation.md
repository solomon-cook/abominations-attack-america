# Audited board implementation

## Rules and coordinates

New local and online games use `human-audited-north-america`, version 1. The source is [the completed human audit](authoritative-board-human-audit.md), SHA-256 `34c9ac6d7f51f3f067cbdd30a4cfbdad32edf4ab0a6f11f43f744a2b3598f952`. Run `npm run board-audit:verify` to check all 336 compiled observations against it.

The board has 187 land, 81 sea, 49 coast and 19 lakeshore cells. Audit row/column coordinates convert to axial engine coordinates with `q = column`, `r = row - floor(column / 2)`. Gameplay, placement, overlays, hit targets and review share this flat-top, staggered-column layout.

Recorded barriers are reciprocal unions, retaining source references from both observations. Visual shorelines do not determine movement restrictions. Lakeshore permits land entry through unblocked edges; naval eligibility and lake-crossing capabilities remain separate. The 18 monster markings are three lairs for each of six monsters, with the user-confirmed `10/2` normalization to Tomanagi.

Existing development, shell and provisional board definitions and their content hashes remain available for pinned saves. Setup materializes each selected monster at its audited lair.

## Camera and controls

The board fills the viewport. Camera cover scale is computed from viewport and map dimensions; zoom runs from that scale to four times it. Pan, wheel, pinch, resize, keyboard focus and minimap operations clamp to map bounds. Details use overlays and preserve camera state. Dragging starts from tiles and suppresses a subsequent selection click.

## Artwork provenance and delivery

`output/board-art/masters` preserves 75 separately generated geography masters, four inland variations and two water variations. `output/board-art/generation` records available prompts and references. Shared geometry, neighbor guides and audit associations live in `output/board-art/manifest.json`. The lean runtime manifest maps engine keys to artwork; the public asset manifest records delivery sizes and source hashes.

The independent tile assembly failed visual seam review because it contained colour patches and shoreline discontinuities. The image generator repaired the assembly, then corrected Baja's bottom-edge extension and the northwest inlet. The final `output/board-art/seamless-board-reviewed.png` was independently reviewed with all 75 unique-cell neighborhoods and the affected neighbors after correction.

All 336 displayed tiles are extracted from this continuous source at exact fractional cell coordinates, preserving links to each original geography master and deterministic inland/water assignment. The public manifest records per-cell source references, neighbors and review evidence. Shared-source crop checks cover every cell; the geography-presence check confirms that every unique coast, lake or island cell still contains both land and water.

Run `npm run board-art:build` to reproduce the assembly, 256/512/1024 WebP derivatives, manifest and verification. Original masters and failed candidates remain preserved. Final derivative totals are 853,500 bytes at 256, 2,021,422 at 512 and 4,535,114 at 1024.

**Detail limit:** the assembled image returned by the generator is 1511 × 1041, despite a larger requested output. The 1024-pixel derivatives are resampled delivery files and do not contain 1024 pixels of native detail per cell. Original higher-resolution tile masters remain available for future detail refinement.

## Verification evidence

- `npm test`: engine and API tests, including audited source, reciprocal barriers, lakeshore movement, lairs, setup and legacy pins.
- `npm run board-camera:verify`: cover bounds and every engine neighbor's rendered geometry.
- `npm run typecheck` and `npm run build`: application compile checks.
- `npm run board-audited-assets:verify`: 336 coordinate mappings, 75 distinct geography sources, 81 distinct master hashes, dimensions and WebP delivery files.
- `npm run browser:audited:verify`: real Chrome setup, camera gestures, overlays and movement/encounter/deployment across seven screen sizes.
- `npm run browser:online:verify`: player/spectator synchronization, reconnect, reload, turn actions and terminal state.

Image processing scripts use Sharp; the browser matrix uses Playwright and Chrome. Sharp and Playwright are declared development dependencies and installed by `npm ci`. Reports and screenshots are under `output/board-art`.

## Review records and scope

- Initial independent review: `output/board-art/review/continuous/independent-review.md`.
- Final corrected-map review: `output/board-art/review/reviewed/independent-review.md` (bound to the exact final image hash).
- Asset mapping and dimensions: `output/board-art/asset-verification.json`.
- Browser matrix and loading metrics: `output/board-art/browser-verification.json`.
- Online player/spectator and reconnect evidence: `output/board-art/online-verification.json`.

Visual review is agent review, not a new human sign-off. Browser measurements use a local production preview and fresh headless Chrome contexts; they are not public-network benchmarks. The online run exercised movement, encounters, deployment and terminal state, but did not reach a battle; combat remains covered by engine/API tests. Accessibility source checks do not substitute a manual assistive-technology audit.
