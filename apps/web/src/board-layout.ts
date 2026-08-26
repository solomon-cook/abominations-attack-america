import { FULL_HONEYCOMB_BOARD, type BoardDefinition, type BoardHex } from "@abominations/game-engine";

export type DisplayHex = Readonly<{
  hex: BoardHex;
  row: number;
  column: number;
  left: number;
  top: number;
}>;

// The player-facing tiles use the flat-top polygon visible in the supplied
// board photo. Flat-top faces overlap horizontally by one quarter of their
// width; alternate rows shift by half a face-height, producing shared edges.
export const DISPLAY_TILE_WIDTH_PERCENT = 4.6;
export const DISPLAY_TILE_STEP_PERCENT = DISPLAY_TILE_WIDTH_PERCENT * 0.75;
export const DISPLAY_TILE_ASPECT_RATIO = 1.1547005;
export const DISPLAY_BOARD_LEFT_PERCENT = 4;
export const DISPLAY_BOARD_TOP_PERCENT = 4;
/** The photographed full rectangle has 24 columns and 14 staggered rows. */
export const DISPLAY_BOARD_ASPECT_RATIO = 1;
/**
 * Top coordinates are percentages of canvas height, while tile width is a
 * percentage of canvas width. Convert the shared-edge tile height into the
 * canvas' vertical percentage before laying out the rows.
 */
export const DISPLAY_BOARD_TOP_SPAN_PERCENT =
  (DISPLAY_TILE_WIDTH_PERCENT / DISPLAY_TILE_ASPECT_RATIO) * 13;

/**
 * Presentation-only layout for the photographed board candidate.
 *
 * The board definition remains axial and authoritative for rules. The
 * candidate is displayed in the photographed orientation as a complete
 * 24-column by 14-row rectangle. Edge faces remain in the model even when
 * the photograph crops or shows them as empty/sea spaces.
 */
export function buildDisplayHexLayout(board: BoardDefinition = FULL_HONEYCOMB_BOARD): DisplayHex[] {
  const columns = Array.from({ length: 24 }, (_, column) => Object.values(board.hexes)
    .filter((hex) => hex.coord.q + Math.floor(hex.coord.r / 2) === column)
    .sort((a, b) => a.coord.r - b.coord.r));
  return columns.flatMap((columnHexes, column) => columnHexes.map((hex, row) => {
    return {
      hex,
      row,
      column,
      left: DISPLAY_BOARD_LEFT_PERCENT + column * DISPLAY_TILE_STEP_PERCENT,
      top: DISPLAY_BOARD_TOP_PERCENT + (row / 13) * DISPLAY_BOARD_TOP_SPAN_PERCENT + (column % 2 ? DISPLAY_TILE_WIDTH_PERCENT / DISPLAY_TILE_ASPECT_RATIO / 2 : 0),
    };
  }));
}
