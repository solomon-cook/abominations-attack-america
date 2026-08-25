import { FULL_HONEYCOMB_BOARD, type BoardDefinition, type BoardHex } from "@abominations/game-engine";

export type DisplayHex = Readonly<{
  hex: BoardHex;
  row: number;
  column: number;
  left: number;
  top: number;
}>;

export const DISPLAY_TILE_WIDTH_PERCENT = 4.45;
export const DISPLAY_TILE_STEP_PERCENT = 4.6;
export const DISPLAY_TILE_ASPECT_RATIO = 1.1547005;
export const DISPLAY_BOARD_LEFT_PERCENT = 5.5;
export const DISPLAY_BOARD_TOP_PERCENT = 10;
export const DISPLAY_BOARD_TOP_SPAN_PERCENT = 80;

/**
 * Presentation-only layout for the photographed board candidate.
 *
 * The board definition remains axial and authoritative for rules. The
 * candidate is displayed as 13 landscape rows of alternating 20/19 cells;
 * flat-top landscape tiles use a half-cell horizontal offset on odd rows.
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
