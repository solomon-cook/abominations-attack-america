import { chooseBranch, chooseLair, chooseMonster, chooseStartingChoice, createSetup, developmentSetupDefinition } from "@abominations/game-engine";
export { developmentSetupDefinition } from "@abominations/game-engine";

export function createDevelopmentSetup(playerCount: 2 | 3 | 4) {
  return createSetup(developmentSetupDefinition(playerCount));
}

export function createCompletedDevelopmentSetup() {
  let setup = createDevelopmentSetup(2);
  setup = chooseMonster(setup, 0, setup.definition.monsterIds[0]!);
  setup = chooseMonster(setup, 1, setup.definition.monsterIds[1]!);
  setup = chooseBranch(setup, 1, setup.definition.eligibleBranches[1]!);
  setup = chooseBranch(setup, 0, setup.definition.eligibleBranches[0]!);
  setup = chooseLair(setup, 0, setup.definition.lairsByMonster[setup.seats[0]!.monsterId!]![0]!);
  setup = chooseLair(setup, 1, setup.definition.lairsByMonster[setup.seats[1]!.monsterId!]![0]!);
  setup = chooseStartingChoice(setup, 0, { kind: "research" });
  return chooseStartingChoice(setup, 1, { kind: "research" });
}
