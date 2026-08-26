import { FULL_HONEYCOMB_BOARD, type BoardDefinition, type BoardHex } from "@abominations/game-engine";

export type DisplayHex = Readonly<{
  hex: BoardHex;
  row: number;
  column: number;
  left: number;
  top: number;
}>;

// The player-facing tiles use a flat-top landscape polygon. In this row-major
// presentation, adjacent tiles use a full-width row pitch; the half-width
// offset on alternate rows supplies the diagonal connections without overlap.
// Keep the pitch wider than each face so the cream substrate remains visibly separated.
export const DISPLAY_TILE_WIDTH_PERCENT = 4.2;
export const DISPLAY_TILE_STEP_PERCENT = 4.45;
export const DISPLAY_TILE_ASPECT_RATIO = 1.1547005;
export const DISPLAY_BOARD_LEFT_PERCENT = 5;
export const DISPLAY_BOARD_TOP_PERCENT = 4;
/** The photographed 20-by-13 lattice is rendered in a landscape canvas. */
export const DISPLAY_BOARD_ASPECT_RATIO = (20 * DISPLAY_TILE_ASPECT_RATIO) / 13;
/**
 * Top coordinates are percentages of canvas height, while tile width is a
 * percentage of canvas width. Convert the shared-edge tile height into the
 * canvas' vertical percentage before laying out the rows.
 */
export const DISPLAY_BOARD_TOP_SPAN_PERCENT =
  (DISPLAY_TILE_WIDTH_PERCENT / DISPLAY_TILE_ASPECT_RATIO) * DISPLAY_BOARD_ASPECT_RATIO * 12;

/**
 * Presentation-only layout for the photographed board candidate.
 *
 * The board definition remains axial and authoritative for rules. The
 * candidate is displayed as 13 landscape rows of alternating 20/19 cells in
 * a fixed-aspect landscape canvas; flat-top landscape tiles use a half-pitch
 * horizontal offset on odd rows and retain a visible seam on every face.
 */
export function buildDisplayHexLayout(board: BoardDefinition = FULL_HONEYCOMB_BOARD): DisplayHex[] {
  return Object.values(board.hexes).map((hex) => {
    const row = hex.coord.r;
    const column = hex.coord.q + Math.floor(row / 2);
    const displayColumn = column + (row % 2 ? 0.5 : 0);
    return {
      hex,
      row,
      column,
      left: DISPLAY_BOARD_LEFT_PERCENT + displayColumn * DISPLAY_TILE_STEP_PERCENT,
      top: DISPLAY_BOARD_TOP_PERCENT + (row / 12) * DISPLAY_BOARD_TOP_SPAN_PERCENT,
    };
  });
}
