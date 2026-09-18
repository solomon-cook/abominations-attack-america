# Monster image assets

`portraits/` contains transparent front-facing WebP portraits (up to 768 pixels) for all six monsters, used in the selection screen and bottom profile. Rebuild with `node scripts/prepare-monster-portraits.mjs` from the existing artwork in `output/imagegen/monsters-front/`. Board sprites remain separate.

These 512×512 RGBA WebP files are optimized delivery copies of the source-backed generated monster sprites. Every sprite has a transparent background for placement over the board. The source images and printed monster records remain authoritative for identity and rules data.
