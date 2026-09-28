import type { BotActionStep, GameCommand, GameState } from "./solo-bots";

export type BotActionRecovery =
  | { type: "error"; message: string }
  | { type: "fallback"; command: GameCommand }
  | { type: "none" };

/** Surface rejected commands; only skip an optional phase when no choice was returned. */
export function recoverBotActionStep(game: GameState, result: BotActionStep): BotActionRecovery {
  if (result.error) {
    return { type: "error", message: `The bot's ${game.phase} action was rejected: ${result.error} The match state has been preserved.` };
  }
  if (result.command || result.state !== game) return { type: "none" };
  if (game.phase === "deploy") return { type: "fallback", command: { type: "pass-deploy" } };
  if (game.phase === "move") return { type: "fallback", command: { type: "pass-move" } };
  return { type: "none" };
}
