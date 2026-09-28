import assert from "node:assert/strict";
import { createGame, type GameState } from "../packages/game-engine/src/index.js";
import type { BotActionStep } from "../packages/game-engine/src/bots.js";
import { recoverBotActionStep } from "../apps/web/src/bot-action-fallback.js";

const moveGame = createGame(2, 29);
moveGame.phase = "move";
const rejectedMove: BotActionStep = {
  state: moveGame,
  command: { type: "pass-move" },
  explanation: "",
  error: "The selected move is illegal.",
};
assert.deepEqual(recoverBotActionStep(moveGame, rejectedMove), {
  type: "error",
  message: "The bot's move action was rejected: The selected move is illegal. The match state has been preserved.",
}, "a rejected command must be reported and must not be converted into pass-move");

const noMoveChoice: BotActionStep = { state: moveGame, explanation: "" };
assert.deepEqual(recoverBotActionStep(moveGame, noMoveChoice), {
  type: "fallback",
  command: { type: "pass-move" },
}, "pass-move remains available when the bot genuinely has no command");

const deployGame = structuredClone(moveGame) as GameState;
deployGame.phase = "deploy";
const noDeploymentChoice: BotActionStep = { state: deployGame, explanation: "" };
assert.deepEqual(recoverBotActionStep(deployGame, noDeploymentChoice), {
  type: "fallback",
  command: { type: "pass-deploy" },
}, "pass-deploy remains available when the bot genuinely has no command");

console.log("Bot action recovery distinguishes rejected commands from no-choice phase passes.");
