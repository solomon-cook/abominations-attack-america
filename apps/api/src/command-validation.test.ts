import assert from "node:assert/strict";
import test from "node:test";
import type { GameCommand } from "@abominations/game-engine";
import { isGameCommand, isGameCommandEnvelope } from "./command-validation.js";

const validCommands = {
  move: { type: "move", path: ["los-angeles", "denver"], continueMovement: true },
  "move-unit": { type: "move-unit", unitId: "unit-1", path: ["los-angeles", "denver"] },
  "disappear-monster": { type: "disappear-monster" },
  "pass-move": { type: "pass-move" },
  "stay-piece": { type: "stay-piece", pieceId: "monster-1" },
  "resolve-fight": { type: "resolve-fight", battleId: "battle-1", spendInfamy: 2, targetUnitId: "unit-1" },
  "launch-submarine": { type: "launch-submarine", battleId: "battle-1", unitId: "unit-1" },
  "launch-submarine-at-monster": { type: "launch-submarine-at-monster", unitId: "unit-1", monsterId: "monster-1" },
  "use-mutation": { type: "use-mutation", cardId: "Berserk", battleId: "battle-1" },
  "choose-mutation-card": { type: "choose-mutation-card", cardId: "Berserk" },
  "choose-stabilizer-ray-mutation": { type: "choose-stabilizer-ray-mutation", cardId: "Berserk" },
  "resolve-chopper-lift": { type: "resolve-chopper-lift", targetMonsterId: "monster-1", destination: "-1,0" },
  "use-monster-ability": { type: "use-monster-ability", ability: "gargantis-heal", mutationCardIds: ["Berserk"] },
  "use-research": {
    type: "use-research",
    cardId: "Chopper Lift",
    battleId: "battle-1",
    mutationCardId: "Berserk",
    researchCardId: "Defense Satellites",
    researchPlayerIndex: 0,
    choice: "retreat",
    destination: "-1,0",
    targetMonsterId: "monster-1",
  },
  retreat: { type: "retreat", destinations: { "monster-1": "-1,0" } },
  "resolve-encounter": { type: "resolve-encounter", choice: "health", trophyUnitId: "unit-1" },
  deploy: { type: "deploy", unitId: "unit-1", destination: "-1,0" },
  redeploy: { type: "redeploy", unitId: "unit-1", destination: "-1,0" },
  "draw-research": { type: "draw-research" },
  "pass-deploy": { type: "pass-deploy" },
  "challenge-opponent": { type: "challenge-opponent", opponentMonsterId: "monster-2" },
  "challenge-giant": { type: "challenge-giant", giantUnitId: "unit-giant" },
  "resolve-challenge": { type: "resolve-challenge", spendInfamy: true, endTurn: false },
  concede: { type: "concede" },
  advance: { type: "advance" },
} satisfies { [Type in GameCommand["type"]]: Extract<GameCommand, { type: Type }> };

type OptionalKeys<Value> = { [Key in keyof Value]-?: {} extends Pick<Value, Key> ? Key : never }[keyof Value];
type RequiredKeys<Value> = Exclude<keyof Value, OptionalKeys<Value> | "type">;

const requiredFieldCoverage = {
  move: { path: true },
  "move-unit": { unitId: true, path: true },
  "disappear-monster": {},
  "pass-move": {},
  "stay-piece": { pieceId: true },
  "resolve-fight": {},
  "launch-submarine": { battleId: true, unitId: true },
  "launch-submarine-at-monster": { unitId: true, monsterId: true },
  "use-mutation": { cardId: true },
  "choose-mutation-card": { cardId: true },
  "choose-stabilizer-ray-mutation": { cardId: true },
  "resolve-chopper-lift": { targetMonsterId: true, destination: true },
  "use-monster-ability": { ability: true, mutationCardIds: true },
  "use-research": { cardId: true },
  retreat: { destinations: true },
  "resolve-encounter": {},
  deploy: {},
  redeploy: { unitId: true },
  "draw-research": {},
  "pass-deploy": {},
  "challenge-opponent": { opponentMonsterId: true },
  "challenge-giant": { giantUnitId: true },
  "resolve-challenge": {},
  concede: {},
  advance: {},
} satisfies { [Type in GameCommand["type"]]: Record<RequiredKeys<Extract<GameCommand, { type: Type }>>, true> };

const optionalFieldCoverage = {
  move: { continueMovement: true },
  "move-unit": {},
  "disappear-monster": {},
  "pass-move": {},
  "stay-piece": {},
  "resolve-fight": { battleId: true, spendInfamy: true, targetUnitId: true },
  "launch-submarine": {},
  "launch-submarine-at-monster": {},
  "use-mutation": { battleId: true },
  "choose-mutation-card": {},
  "choose-stabilizer-ray-mutation": {},
  "resolve-chopper-lift": {},
  "use-monster-ability": {},
  "use-research": { battleId: true, mutationCardId: true, researchCardId: true, researchPlayerIndex: true, choice: true, destination: true, targetMonsterId: true },
  retreat: {},
  "resolve-encounter": { choice: true, trophyUnitId: true },
  deploy: { unitId: true, destination: true },
  redeploy: { destination: true },
  "draw-research": {},
  "pass-deploy": {},
  "challenge-opponent": {},
  "challenge-giant": {},
  "resolve-challenge": { spendInfamy: true, endTurn: true },
  concede: {},
  advance: {},
} satisfies { [Type in GameCommand["type"]]: Record<OptionalKeys<Extract<GameCommand, { type: Type }>>, true> };

const allCommands = Object.values(validCommands) as GameCommand[];

test("runtime validator accepts an example for every GameCommand variant", () => {
  assert.equal(allCommands.length, 25);
  for (const command of allCommands) assert.equal(isGameCommand(command), true, command.type);
});

test("runtime validator rejects every omitted required field and checks every optional field when supplied", () => {
  const examples = validCommands as unknown as Record<string, Record<string, unknown>>;
  for (const [type, fields] of Object.entries(requiredFieldCoverage)) {
    for (const field of Object.keys(fields)) {
      const command = { ...examples[type]! };
      delete command[field];
      assert.equal(isGameCommand(command), false, `${type}.${field} is required`);
    }
  }
  for (const [type, fields] of Object.entries(optionalFieldCoverage)) {
    const command = examples[type]!;
    for (const field of Object.keys(fields)) {
      const omitted = { ...command };
      delete omitted[field];
      assert.equal(isGameCommand(omitted), true, `${type}.${field} may be omitted`);
      assert.equal(isGameCommand({ ...command, [field]: null }), false, `${type}.${field} rejects null`);
    }
  }
});

test("runtime validator rejects unknown commands and malformed command payloads", () => {
  const malformed: unknown[] = [
    { type: "not-a-command" },
    { type: "move", path: "los-angeles,denver" },
    { type: "move", path: [], continueMovement: "yes" },
    { type: "move-unit", unitId: "unit-1", path: ["denver", 3] },
    { type: "stay-piece" },
    { type: "resolve-fight", spendInfamy: "2" },
    { type: "launch-submarine", battleId: "battle-1" },
    { type: "launch-submarine-at-monster", unitId: "unit-1" },
    { type: "use-mutation", cardId: "Cutbacks" },
    { type: "choose-mutation-card" },
    { type: "choose-stabilizer-ray-mutation", cardId: null },
    { type: "resolve-chopper-lift", targetMonsterId: "monster-1" },
    { type: "resolve-chopper-lift", targetMonsterId: "monster-1", destination: "not-a-hex" },
    { type: "use-monster-ability", ability: "gargantis-heal" },
    { type: "use-monster-ability", ability: "unknown", mutationCardIds: [] },
    { type: "use-research", cardId: "Berserk" },
    { type: "use-research", cardId: "Chopper Lift", choice: "health" },
    { type: "use-research", cardId: "Chopper Lift", destination: "not-a-hex" },
    { type: "retreat", destinations: [] },
    { type: "retreat", destinations: { "monster-1": 4 } },
    { type: "retreat", destinations: { "monster-1": "not-a-hex" } },
    { type: "resolve-encounter", choice: "research" },
    { type: "resolve-encounter", trophyUnitId: null },
    { type: "deploy", destination: 42 },
    { type: "deploy", destination: "not-a-hex" },
    { type: "redeploy", destination: "not-a-hex" },
    { type: "challenge-opponent" },
    { type: "challenge-giant", giantUnitId: 7 },
    { type: "resolve-challenge", spendInfamy: "yes" },
    { type: "resolve-fight", spendInfamy: 1.5 },
    { type: "use-research", cardId: "Cutbacks", researchPlayerIndex: -1 },
  ];
  for (const command of malformed) assert.equal(isGameCommand(command), false, JSON.stringify(command));
});

test("command envelope validator includes command shape and still checks envelope fields", () => {
  const base = {
    actionId: "action-1",
    actorId: "participant-1",
    expectedRevision: 0,
    protocolVersion: 1,
    command: { type: "use-monster-ability", ability: "gargantis-heal" },
  };
  assert.equal(isGameCommandEnvelope({ ...base, command: { type: "pass-move" } }), true);
  assert.equal(isGameCommandEnvelope(base), false);
  assert.equal(isGameCommandEnvelope({ ...base, expectedRevision: -1, command: { type: "pass-move" } }), false);
});
