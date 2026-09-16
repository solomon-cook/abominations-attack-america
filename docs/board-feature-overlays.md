# Board feature overlays

The live audited board uses `apps/web/src/components/BoardFeatureOverlays.tsx` and `apps/web/src/board-feature-overlays.css`. `BoardTerrain.tsx` re-exports `FeatureMarkers` to preserve the existing `HexGrid` integration. The component reads `BoardHex.features`; it does not change board data, layout, terrain, camera state or piece rendering.

Artwork lives in `apps/web/public/assets/board/overlays/`. Lairs select the full-hex vector asset by `monsterId`; Challenge fills the hex; city, Infamy and Mutation symbols occupy the upper lane, and military stars share the lower row. The layer uses `pointer-events: none` and sits below pieces and interaction feedback. Styles are scoped to `.audited-features`.

Asset URLs include `?v=vector-2` so existing service-worker image caches do not reuse earlier raster-based lairs. Increment this revision when replacing these assets. No service-worker policy change is required.

Regenerate assets with `node scripts/build-hex-overlays.mjs`; the six vector monster definitions are in `scripts/monster-icon-paths.mjs`. Regenerate the preview with `node scripts/preview-hex-overlays.mjs`. Board terrain generation should not write to the overlays directory.

Full-hex site art has no opaque hex field; scoped opacity and desaturation make it read as printing. Live monster pieces continue to use the bitmap WebP sprites, sized by `board-pieces.css`. `StompedMarker` uses the existing stomp bitmap and is shown only for locations in `game.stompedLocations`, above features and below pieces.
