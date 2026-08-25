# Generated military sprite direction

## Branch palette

The designated colours are stored in [military-branch-palette.json](military-branch-palette.json):

| Branch | Designated colour | Hex |
| --- | --- | --- |
| Marines | Coral red | `#D9483F` |
| Air Force | Aviation yellow | `#F2C230` |
| Army | Olive green | `#647A2E` |
| Navy | Deep blue | `#1F78B4` |
| National Guard | Safety orange | `#E58A25` |

These colours are art-direction values matched visually to the branch cards, not instrument-sampled reproductions of the original plastic.

## Style study

[Military sprite style study](military-sprite-style-study.png) contains ten orthographic plastic-model treatments derived from the white unit silhouettes on the branch cards:

1. Marines fighter and rocket launcher.
2. Air Force fighter and cruise missile.
3. Army tank and missile launcher.
4. Navy fighter and nuclear submarine.
5. National Guard tank and fighter.

The sheet is a visual direction study, not a production sprite atlas. Its checkerboard is baked into the RGB image rather than stored as alpha.

## Individual unit set

Ten separate 1254 x 1254 PNG unit images are stored in [military-sprites](military-sprites/). They use the branch-card silhouettes as shape references and the palette above as their designated plastic colours.

### Transparent assets

- Marines: fighter; rocket launcher.
- Air Force: fighter.
- Army: tank.
- Navy: fighter; nuclear submarine.

These six files are RGBA PNGs with transparent pixels outside the unit. They are retained as sprite candidates, although generated edge alpha and proportions should still be checked in the target game at final display size.

### Reference-only assets

- Air Force: cruise missile.
- Army: missile launcher.
- National Guard: tank; fighter.

These four files are complete visual concepts but their checkerboard background is baked into RGB. They are deliberately kept in `reference-only/` and must not be treated as transparent production sprites. Multiple built-in regeneration attempts did not reliably return usable alpha for these units.

## Lightweight web derivatives

The web-ready derivatives live in `apps/web/public/assets/military/`. Every unit is normalized onto a transparent 256 x 256 canvas and encoded as WebP. The ten unit types use eleven sprites because the Navy nuclear submarine has separate `submarine` and `launched-cruise-missile` visual states. The complete set is approximately 77 KB, with individual files ranging from approximately 3 KB to 11 KB. A colocated `manifest.json` records each stable public URL, branch, unit type, state where applicable, and designated colour.

For the four reference-only RGB sources, the web derivative's alpha was reconstructed from the saturated branch-colour silhouette. This removes the neutral checkerboard while retaining the generated unit; these derivatives were checked together on a transparency grid.

## Generation prompt

Built-in image generation used the three military record images as shape references. The individual-unit prompt required one centred unit, an exact 90-degree orthographic top-down view, one-piece injection-moulded plastic, a solid designated branch colour, restrained moulded detail, even square-canvas padding, and no bases, text, logos, scenery, shadows, glow, or extra objects. Genuine transparent RGBA output was requested for every unit; files that failed that requirement are segregated as reference-only above.
