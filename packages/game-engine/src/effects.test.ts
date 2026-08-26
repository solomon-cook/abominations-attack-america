import assert from "node:assert/strict";
import test from "node:test";
import { EFFECT_BOUNDARIES, composeContinuousEffects } from "./effects.js";

test("effect accumulator composes additive, replacement, and permission effects", () => {
  const result = composeContinuousEffects([
    { moveBonus: 1, movement: "land-only", canControlNationalGuard: true },
    { moveBonus: 1, movement: "fly", extraDeployments: 1 },
    { defenseBonus: 1, crossesWaterBarriers: true },
  ]);
  assert.equal(result.moveBonus, 2);
  assert.equal(result.movement, "fly");
  assert.equal(result.extraDeployments, 1);
  assert.equal(result.defenseBonus, 1);
  assert.equal(result.crossesWaterBarriers, true);
  assert.equal(result.canControlNationalGuard, true);
});

test("effect boundaries enumerate implemented categories and preserve a source-gated boundary", () => {
  const categories = new Set(EFFECT_BOUNDARIES.map((boundary) => boundary.category));
  assert.deepEqual([...categories].sort(), ["attack-change", "control-override", "movement-ability", "placement", "stat-modifier", "triggered"]);
  assert.equal(EFFECT_BOUNDARIES.some((boundary) => boundary.availability === "source-gated"), true);
  assert.equal(EFFECT_BOUNDARIES.every((boundary) => boundary.sourceRefs.length > 0), true);
});
