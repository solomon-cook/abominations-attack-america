import { createSetup, developmentSetupDefinition } from "@abominations/game-engine";
export { developmentSetupDefinition } from "@abominations/game-engine";

export function createDevelopmentSetup(playerCount: 2 | 3 | 4) {
  return createSetup(developmentSetupDefinition(playerCount));
}
