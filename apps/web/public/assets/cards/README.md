# Card image assets

The seven sheet WebP files are optimized delivery copies of the source card-sheet photographs. The individual Military Research and Monster Mutation web cards use 32 title-free illustration crops (`*-art.webp`) generated from the concept artwork. Their text-free web images contain no card titles or rules panels.

The previous full-text card faces are retained locally in `references/monsters-menace-america/components/decks/full-text-card-archive/`. Regenerate the art-only delivery assets and refresh that archive with `python3 scripts/prepare-art-only-card-assets.py`.

The game engine and `SOURCED_CARD_RULES` remain authoritative for card identity and wording; the web card face itself contains illustration only.
