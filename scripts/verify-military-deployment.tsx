import React from "react";
// The standalone tsx runner uses the classic JSX runtime for imported UI files.
Object.assign(globalThis, { React });
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createGame, deployUnitResult, projectState } from "../packages/game-engine/src/index";
import { deploymentChoices, nextDeploymentSheet } from "../apps/web/src/components/MilitarySheet";
import { ownedMilitarySheets } from "../apps/web/src/components/owned-sheets";
import { MilitaryReference } from "../apps/web/src/components/SheetReference";
import { PhaseActions } from "../apps/web/src/components/PhaseActions";

const game = createGame(2);
game.phase = "deploy";
game.pendingDecision = { type: "deployment", playerIndex: 0 };
game.units.filter(unit => unit.branch === "Army").forEach(unit => { unit.location = "record-tile"; });
const initial = deploymentChoices(game);
assert.equal(nextDeploymentSheet(initial, "Army"), "Army");
const branch = initial.find(choice => choice.sheet === "Army")!;
assert.ok(branch);
const placed = deployUnitResult(game, { unitId: branch.id, destination: branch.destinations[0] }).state;
const remaining = deploymentChoices(placed);
assert.ok(remaining.some(choice => choice.sheet === "National Guard"));
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
const actions = (state: typeof game) => renderToStaticMarkup(<PhaseActions activeGame={state} onOpenMilitarySheet={() => {}} canAct runCommand={() => {}} getLocationName={key => key} pendingAttackPrompt="" canSpendInfamyOnPendingBattle={false} retreatChoices={{}} setRetreatChoices={() => {}} />);
assert.ok(actions(game).includes("Draw Military Research instead"));
assert.ok(!actions(placed).includes("Draw Military Research"));
assert.ok(!actions(placed).includes("Deploy or draw"));
console.log("PASS: branch-to-Guard routing, commander ownership including online projection, visible details, removed photo link, and research hidden after deployment.");

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
