import React from "react";
import { createRequire } from "node:module";
// The standalone tsx runner uses the classic JSX runtime for imported UI files.
Object.assign(globalThis, { React });
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, deployUnitResult, locationIdToHexKey, projectState } from "../packages/game-engine/src/index";

const game = createGame(2);
const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { deploymentChoices, nextDeploymentSheet } = require("../apps/web/src/components/MilitarySheet.tsx") as typeof import("../apps/web/src/components/MilitarySheet");
const { ownedMilitarySheets } = require("../apps/web/src/components/owned-sheets.ts") as typeof import("../apps/web/src/components/owned-sheets");
const { MilitaryReference } = require("../apps/web/src/components/SheetReference.tsx") as typeof import("../apps/web/src/components/SheetReference");
const { PhaseActions } = require("../apps/web/src/components/PhaseActions.tsx") as typeof import("../apps/web/src/components/PhaseActions");
const { MovementChecklist } = require("../apps/web/src/components/MovementChecklist.tsx") as typeof import("../apps/web/src/components/MovementChecklist");
const { SheetCards } = require("../apps/web/src/components/SheetCards.tsx") as typeof import("../apps/web/src/components/SheetCards");
game.phase = "deploy";
game.pendingDecision = { type: "deployment", playerIndex: 0 };
game.units.filter(unit => unit.branch === "Army").forEach(unit => { unit.location = "record-tile"; });
const initial = deploymentChoices(game);
assert.equal(nextDeploymentSheet(initial, "Army"), "Army");
const branch = initial.find(choice => choice.sheet === "Army")!;
assert.ok(branch);
const secondGeneration = structuredClone(game);
secondGeneration.players[0]!.researchCardIds = ["2nd Generation"];
secondGeneration.deploymentsThisTurn = 2;
assert.ok(deploymentChoices(secondGeneration).some(choice => choice.sheet === "Army" && choice.kind === "deploy"), "2nd Generation should expose the third branch deployment");
secondGeneration.players[0]!.researchCardIds = [];
assert.ok(!deploymentChoices(secondGeneration).some(choice => choice.sheet === "Army" && choice.kind === "deploy"), "without the passive card the third branch deployment is closed");
secondGeneration.players[0]!.researchCardIds = ["2nd Generation"];
secondGeneration.deploymentsThisTurn = 3;
assert.ok(deploymentChoices(secondGeneration).some(choice => choice.sheet === "National Guard" && choice.kind === "deploy"), "2nd Generation should permit its extra Guard deployment");
console.log("PASS: 2nd Generation opens one extra branch or National Guard deployment slot and closes the branch slot without the card.");
const placed = deployUnitResult(game, { unitId: branch.id, destination: branch.destinations[0] }).state;
const remaining = deploymentChoices(placed);
assert.ok(remaining.some(choice => choice.sheet === "National Guard"));
const redeploymentState = structuredClone(game);
redeploymentState.players[0]!.researchCardIds = ["2nd Generation"];
redeploymentState.units.find(unit => unit.id === branch.id)!.location = branch.destinations[0]!;
const redeploymentChoices = deploymentChoices(redeploymentState);
const redeployment = redeploymentChoices.find(choice => choice.kind === "redeploy");
assert.ok(redeployment, "a deployed piece should remain available as a legal redeployment choice");
assert.equal(nextDeploymentSheet(remaining, "Army"), "National Guard", "Used branch destination should send the player to legal Guard pieces");
const exhaustedBranch = structuredClone(game);
exhaustedBranch.deploymentsThisTurn = 2;
assert.equal(nextDeploymentSheet(deploymentChoices(exhaustedBranch), "Army"), "National Guard");
exhaustedBranch.players[1].researchCardIds = ["Guard Commander"];
for (const state of [exhaustedBranch, projectState(exhaustedBranch, "player", 0)]) {
  assert.ok(!deploymentChoices(state).some(choice => choice.sheet === "National Guard"));
  assert.ok(!ownedMilitarySheets(state, 0, "Army").includes("National Guard"));
  assert.ok(ownedMilitarySheets(state, 1, "Navy").includes("National Guard"));
}
exhaustedBranch.players[1].researchCardIds = [];
exhaustedBranch.players[0].researchCardIds = ["Guard Commander"];
assert.equal(nextDeploymentSheet(deploymentChoices(exhaustedBranch), "Army"), "National Guard");
const reference = renderToStaticMarkup(<MilitaryReference sheet="Army" game={game} />);
assert.ok(reference.includes("Defense"));
assert.ok(!reference.includes("<details"));
assert.ok(!reference.includes("physical sheet"));
const deploymentReference = renderToStaticMarkup(<MilitaryReference sheet="Army" game={redeploymentState} choices={redeploymentChoices.filter(choice => choice.sheet === "Army")} onSelect={() => undefined} />);
assert.match(deploymentReference, /Redeploy army tank piece/);
assert.match(deploymentReference, /IN RESERVE/);
const actions = (state: typeof game) => renderToStaticMarkup(<PhaseActions activeGame={state} onOpenMilitarySheet={() => {}} canAct runCommand={() => {}} getLocationName={key => key} pendingAttackPrompt="" canSpendInfamyOnPendingBattle={false} retreatChoices={{}} setRetreatChoices={() => {}} />);
assert.ok(actions(game).includes("Draw Military Research instead"));
assert.ok(!actions(placed).includes("Draw Military Research"));
assert.ok(!actions(placed).includes("Deploy or draw"));
console.log("PASS: branch-to-Guard routing, commander ownership including online projection, visible details, removed photo link, and research hidden after deployment.");

const guardMovement = createGame(2);
guardMovement.currentPlayer = 0;
guardMovement.phase = "move";
guardMovement.players[0]!.researchCardIds = ["Guard Commander"];
const controlledGuard = { ...guardMovement.units[0]!, id: "national-guard-tank-1", branch: "National Guard" as const, unitTypeId: "national-guard-tank", ownerPlayer: undefined, location: locationIdToHexKey("denver")!, move: 3, movement: "land-only" as const };
guardMovement.units = [...guardMovement.units, controlledGuard];
const guardChecklist = (state: typeof guardMovement) => renderToStaticMarkup(<MovementChecklist game={projectState(state, "player", state.currentPlayer)} canAct selectedUnitId={null} movableUnitIds={new Set([controlledGuard.id])} monsterCanMove={false} onSelect={() => undefined} onEnd={() => undefined} />);
const heldGuardChecklist = guardChecklist(guardMovement);
assert.match(heldGuardChecklist, /national guard tank/);
assert.match(heldGuardChecklist, />Move</);
guardMovement.players[0]!.researchCardIds = [];
assert.doesNotMatch(guardChecklist(guardMovement), /national guard tank/);
console.log("PASS: Guard Commander adds the neutral Guard unit to the holder's actual Move checklist and removes it when the card is absent.");

for (const cardId of ["Mecha-Monster", "Captain Colossal"] as const) {
  const giantCardState = createGame(2);
  giantCardState.currentPlayer = 0;
  giantCardState.phase = "deploy";
  giantCardState.pendingDecision = { type: "deployment", playerIndex: 0 };
  giantCardState.players[0]!.researchCardIds = [cardId];
  const giantHand = (state: typeof giantCardState) => renderToStaticMarkup(<SheetCards game={projectState(state, "player", state.currentPlayer)} playerIndex={state.currentPlayer} kind="research" canAct runCommand={() => undefined} />);
  const playableGiant = giantHand(giantCardState);
  assert.match(playableGiant, /Place at /);
  assert.doesNotMatch(playableGiant, /<button[^>]*disabled=""[^>]*>Place at /);
  giantCardState.phase = "move";
  giantCardState.pendingDecision = { type: "monster-movement", playerIndex: 0, pieceId: giantCardState.monsters[0]!.id };
  assert.doesNotMatch(giantHand(giantCardState), /Place at /);
}
console.log("PASS: Mecha-Monster and Captain Colossal hand controls expose active-base placement during Deploy and no action during Move.");

const xFighterState = createGame(2);
xFighterState.currentPlayer = 0;
xFighterState.phase = "deploy";
xFighterState.pendingDecision = { type: "deployment", playerIndex: 0 };
xFighterState.players[0]!.researchCardIds = ["X-Fighters"];
for (let index = 1; index <= 2; index += 1) xFighterState.units.push({ ...xFighterState.units[0]!, id: `x-fighter-1-${index}`, branch: "Giant", unitTypeId: "x-fighter", ownerPlayer: 0, location: "record-tile", move: 6, movement: "fly", attacks: 1, damage: 2, health: 1, defense: 5 });
const xChoices = deploymentChoices(xFighterState);
assert.equal(xChoices.filter((choice) => choice.sheet === "X-Fighters" && choice.kind === "deploy").length, 2);
const xSheet = renderToStaticMarkup(<MilitaryReference sheet="X-Fighters" game={xFighterState} choices={xChoices.filter((choice) => choice.sheet === "X-Fighters")} onSelect={() => undefined} />);
assert.match(xSheet, /Move/);
assert.match(xSheet, /Fly/);
assert.match(xSheet, /Defense/);
const xHand = renderToStaticMarkup(<SheetCards game={projectState(xFighterState, "player", 0)} playerIndex={0} kind="research" canAct runCommand={() => undefined} onDeploy={() => undefined} />);
assert.match(xHand, /Choose an X-Fighter to deploy/);
console.log("PASS: both X-Fighter reserve pieces appear as separate deploy choices and the hand card routes to their military record.");

// Giants have visible records before placement and retain their portrait in play.
for (const [id, name, health] of [["captain-colossal", "Captain Colossal", 8], ["mecha-monster", "Mecha-Monster", 6]] as const) {
  const state = structuredClone(game);
  state.players[0].researchCardIds = [name];
  assert.ok(ownedMilitarySheets(state, 0, "Army").includes(name));
  assert.ok(!ownedMilitarySheets(state, 1, "Navy").includes(name));
  const held = renderToStaticMarkup(<MilitaryReference sheet={name} game={state} />);
  assert.ok(held.includes(`/assets/military/portraits/${id}.webp`));
  assert.ok(held.includes("Ready to deploy"));
  state.players[0].researchCardIds = [];
  state.units.push({ id: `${id}-1`, unitTypeId: id, branch: "Giant", ownerPlayer: 0, location: state.monsters[0].location, health: health - 2, move: 4, movement: "land-lake", attacks: 1, defense: 4, damage: 2 });
  assert.ok(ownedMilitarySheets(state, 0, "Army").includes(name));
  const placedRecord = renderToStaticMarkup(<MilitaryReference sheet={name} game={state} />);
  assert.ok(placedRecord.includes(`${health - 2} / ${health}`));
  assert.ok(placedRecord.includes(`/assets/military/portraits/${id}.webp`));
}
console.log("PASS: giant research ownership, persistent portraits, and current health on military records.");
