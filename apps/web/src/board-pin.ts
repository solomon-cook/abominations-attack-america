import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, type BoardDefinition, type GameState } from "@abominations/game-engine";

/** Resolve only board definitions whose complete immutable identity, version, and content hash match the match pin. */
export function boardForGame(game: Pick<GameState, "boardId" | "boardVersion" | "boardContentHash">): BoardDefinition | undefined {
  if (game.boardId === FULL_HONEYCOMB_BOARD.id && game.boardVersion === FULL_HONEYCOMB_BOARD.version && game.boardContentHash === FULL_HONEYCOMB_BOARD.contentHash) return FULL_HONEYCOMB_BOARD;
  if (game.boardId === DEVELOPMENT_BOARD.id && game.boardVersion === DEVELOPMENT_BOARD.version && game.boardContentHash === DEVELOPMENT_BOARD.contentHash) return DEVELOPMENT_BOARD;
  return undefined;
}
