import {
  AUDITED_BOARD,
  FULL_HONEYCOMB_BOARD,
  PROVISIONAL_AUTHORITATIVE_BOARD,
  locationIdToHexKey,
  locations,
  type BoardDefinition,
  type BoardHex,
} from "@abominations/game-engine";

export type DisplayHex = Readonly<{
  hex: BoardHex;
  row: number;
  column: number;
  left: number;
  top: number;
}>;

export type RenderedDisplayHex = Readonly<{
  hex: BoardHex;
  place?: (typeof locations)[number];
  left: number;
  top: number;
  developmentFixture: boolean;
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
/** Natural, regular flat-top geometry for the audited 24 × 14 board. */
export const AUDITED_TILE_WIDTH_PERCENT = 100 / 18.25;
export const AUDITED_BOARD_ASPECT_RATIO = 18.25 / (14.5 / DISPLAY_TILE_ASPECT_RATIO);
export const AUDITED_BOARD_WORLD = { width: 1000, height: 1000 / AUDITED_BOARD_ASPECT_RATIO };
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
  if (Object.values(board.hexes).some((hex) => hex.audit)) {
    return Object.values(board.hexes).map((hex) => {
      const { row, column } = hex.audit!;
      return { hex, row, column,
        left: (0.5 + column * 0.75) * AUDITED_TILE_WIDTH_PERCENT,
        top: (0.5 + row + (column % 2 ? 0.5 : 0)) / 14.5 * 100,
      };
    });
  }
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

/**
 * Match HexGrid's presentation positions for a pinned board. The nine-space
 * development board is drawn on the candidate shell, with outlying named
 * fixture locations placed using their location coordinates. BoardViewport
 * uses this projection too, so a camera focus tracks the rendered hit target.
 */
export function renderedHexLayout(board: BoardDefinition | undefined): RenderedDisplayHex[] {
  if (!board) return [];
  if (board.id === AUDITED_BOARD.id || board.id === FULL_HONEYCOMB_BOARD.id || board.id === PROVISIONAL_AUTHORITATIVE_BOARD.id) {
    return buildDisplayHexLayout(board).map(({ hex, left, top }) => ({ hex, left, top, developmentFixture: false }));
  }

  const developmentPlaces = new Map(locations.map((place) => [locationIdToHexKey(place.id), place]));
  const developmentHexes = new Map(Object.values(board.hexes).map((hex) => [hex.key, hex]));
  const candidateLayout = buildDisplayHexLayout(FULL_HONEYCOMB_BOARD);
  const candidateKeys = new Set(candidateLayout.map(({ hex }) => hex.key));
  const shell = candidateLayout.map(({ hex: candidateHex, left, top }) => {
    const developmentHex = developmentHexes.get(candidateHex.key);
    return {
      hex: developmentHex ?? candidateHex,
      place: developmentPlaces.get(candidateHex.key),
      left,
      top,
      developmentFixture: Boolean(developmentHex),
    };
  });
  const outlyingDevelopmentHexes = [...developmentHexes.values()]
    .filter((hex) => !candidateKeys.has(hex.key))
    .map((hex) => {
      const place = developmentPlaces.get(hex.key);
      return { hex, place, left: place?.x ?? 50, top: place?.y ?? 50, developmentFixture: true };
    });
  return [...shell, ...outlyingDevelopmentHexes];
}
