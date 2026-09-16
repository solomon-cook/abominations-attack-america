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

The initial independent tile assembly passed mapping checks but failed visual seam review: it contains colour patches and shoreline discontinuities. `seamless-board-candidate.png` is an image-generator edit of that assembly for geographic review. Its actual native size is 1511 × 1041; requested larger dimensions were not returned. Enlarged delivery derivatives cannot add native detail. Original masters remain preserved.

`scripts/slice-continuous-board.mjs` can extract this assembled edit at exact fractional cell coordinates after review. It preserves links to each original geography master and deterministic inland/water assignment. Do not treat generation or derivative existence as visual approval.

## Verification evidence

- `npm test`: engine and API tests, including audited source, reciprocal barriers, lakeshore movement, lairs, setup and legacy pins.
- `npm run board-camera:verify`: cover bounds and every engine neighbor's rendered geometry.
- `npm run typecheck` and `npm run build`: application compile checks.
- `npm run board-audited-assets:verify`: 336 coordinate mappings, 75 distinct geography sources, 81 distinct master hashes, dimensions and WebP delivery files.
- `npm run browser:audited:verify`: real Chrome setup, camera gestures, overlays and movement/encounter/deployment across five screen sizes.
- `npm run browser:online:verify`: player/spectator synchronization, reconnect, reload, turn actions and terminal state.

Image processing scripts use Sharp; the browser matrix uses Playwright and Chrome. Sharp and Playwright are declared development dependencies and installed by `npm ci`. Reports and screenshots are under `output/board-art`.

## Outstanding review

Final assembled geography and neighborhood approval, the final derivative publication, and full browser regression results must be recorded before artwork completion is claimed. The current report intentionally distinguishes implemented gameplay from unfinished visual review.
