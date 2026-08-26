# Board camera contract

The board camera uses one bounded interaction model across pointer dragging, pan buttons, keyboard activation of those buttons, and wheel zoom:

- Zoom is clamped to `0.90x`-`1.75x`, with `1.00x` as the reset/default framing.
- Panning is clamped to the scaled board extent: no pan is possible below `1.00x`, and at larger zoom the translation is limited to `(zoom - 1) x 50%` on each axis.
- Changing zoom immediately reclamps the current pan, so zooming out cannot leave the board detached from the map surface.
- Fit / reset returns to `1.00x` and zero translation.

These are presentation bounds, not gameplay coordinates. The browser smoke and responsive contract verify the shared controls; the source-level camera helpers keep every input path on the same clamps.
