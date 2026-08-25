import { FULL_HONEYCOMB_BOARD, type BoardDefinition, type BoardHex } from "@abominations/game-engine";

export type DisplayHex = Readonly<{
  hex: BoardHex;
  row: number;
  column: number;
  left: number;
  top: number;
}>;

/**
 * Presentation-only layout for the photographed board candidate.
 *
 * The board definition remains axial and authoritative for rules. The
 * candidate is displayed as 13 landscape rows of alternating 20/19 cells;
 * pointy-top tiles use a half-cell horizontal offset on odd rows.
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
      left: 5.5 + displayColumn * 4.6,
      top: 10 + (row / 12) * 80,
    };
  });
}
