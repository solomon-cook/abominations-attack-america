import assert from "node:assert/strict";
import test from "node:test";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, boardContentHash, buildBoardIndex, diagnoseBoard, hexDistance, hexKey, hexKeyToLocationId, locationIdToHexKey, toDevelopmentSpaceKey, validateBoardDefinition } from "./board.js";

test("development board is structurally valid but not production-ready", () => {
  assert.deepEqual(validateBoardDefinition(DEVELOPMENT_BOARD), []);
  assert.equal(validateBoardDefinition(DEVELOPMENT_BOARD, { production: true }).length > 0, true);
  assert.equal(buildBoardIndex(DEVELOPMENT_BOARD).featureHexes.city.length, 5);
});

test("full-board candidate contains the complete honeycomb coordinate shell but remains blocked", () => {
  assert.equal(Object.keys(FULL_HONEYCOMB_BOARD.hexes).length, 254);
  assert.equal(FULL_HONEYCOMB_BOARD.edges.length > 0, true);
  assert.equal(Object.values(FULL_HONEYCOMB_BOARD.hexes).every((hex) => hex.verification === "unresolved"), true);
  assert.equal(validateBoardDefinition(FULL_HONEYCOMB_BOARD).length, 0);
  assert.equal(validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true }).length, 254);
});

test("axial identity and distance are independent of display geometry", () => {
  assert.equal(hexKey({ q: 2, r: -1 }), "2,-1");
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
});

test("development names are only compatibility aliases for canonical hex keys", () => {
  assert.equal(locationIdToHexKey("denver"), "-1,0");
  assert.equal(hexKeyToLocationId("-1,0"), "denver");
  assert.equal(toDevelopmentSpaceKey("denver"), "-1,0");
  assert.equal(toDevelopmentSpaceKey("record-tile"), "record-tile");
  assert.equal(toDevelopmentSpaceKey("not-a-space"), undefined);
});

test("board diagnostics expose review gaps without changing movement topology", () => {
  const diagnostics = diagnoseBoard(DEVELOPMENT_BOARD);
  assert.equal(diagnostics.connectedComponents.length, 1);
  assert.deepEqual(diagnostics.isolatedHexes, []);
  assert.deepEqual(diagnostics.disabledOnlyHexes, []);
  assert.deepEqual(diagnostics.duplicateLabels, []);
  assert.deepEqual(diagnostics.duplicateCoordinates, []);
  assert.equal(diagnostics.featureCounts.city, 5);
  assert.equal(diagnostics.featureCounts["military-base"], 1);
});

test("a hex can carry multiple composable features without changing its identity", () => {
  const sourceHex = DEVELOPMENT_BOARD.hexes["-2,2"];
  const compositeCore = {
    id: DEVELOPMENT_BOARD.id,
    version: DEVELOPMENT_BOARD.version,
    name: DEVELOPMENT_BOARD.name,
    rulesetVersion: DEVELOPMENT_BOARD.rulesetVersion,
    hexes: {
      ...DEVELOPMENT_BOARD.hexes,
      "-2,2": {
        ...sourceHex,
        features: [...sourceHex.features, { kind: "los-angeles" as const }, { kind: "hollywood" as const }]
      }
    },
    edges: DEVELOPMENT_BOARD.edges
  };
  const composite = { ...compositeCore, contentHash: boardContentHash(compositeCore) };
  assert.deepEqual(validateBoardDefinition(composite), []);
  assert.equal(buildBoardIndex(composite).featureHexes["los-angeles"].length, 1);
  assert.equal(buildBoardIndex(composite).featureHexes.hollywood.length, 1);
});
