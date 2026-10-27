# Board camera contract

The board camera uses one bounded interaction model across pointer dragging, pan buttons, keyboard activation of those buttons, and wheel zoom:

- Zoom is clamped to `1.00x`-`4.00x`; `1.00x` contains the complete 336-cell board in the viewport and is the reset/default framing.
- The fit view stays centred. At larger zoom, panning is clamped so the viewport remains over the padded ocean background.
- Changing zoom immediately reclamps the current pan, so zooming out cannot leave the board detached from the map surface.
- Fit / reset returns to `1.00x`, centres the board, and keeps all 336 cell faces visible. A separate `1.00x`-`4.00x` tactical zoom keeps labels and pieces readable for local actions.

These are presentation bounds, not gameplay coordinates. The browser smoke and responsive contract verify the shared controls; the source-level camera helpers keep every input path on the same clamps.
