import assert from "node:assert/strict";
import test from "node:test";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PROVISIONAL_AUTHORITATIVE_BOARD, boardContentHash, buildBoardIndex, diagnoseBoard, hexDistance, hexKey, hexKeyToLocationId, locationIdToHexKey, toDevelopmentSpaceKey, validateBoardDefinition } from "./board.js";

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
  const productionErrors = validateBoardDefinition(FULL_HONEYCOMB_BOARD, { production: true });
  assert.equal(productionErrors.length, Object.keys(FULL_HONEYCOMB_BOARD.hexes).length * 2 + FULL_HONEYCOMB_BOARD.edges.length);
  assert.equal(productionErrors.some((error) => error.includes("water class is unresolved")), true);
  assert.equal(productionErrors.some((error) => error.includes("barrier is unresolved")), true);
});

test("production validation cannot be bypassed by marking unresolved hexes verified", () => {
  const disguisedCore = {
    id: FULL_HONEYCOMB_BOARD.id,
    version: FULL_HONEYCOMB_BOARD.version,
    name: FULL_HONEYCOMB_BOARD.name,
    rulesetVersion: FULL_HONEYCOMB_BOARD.rulesetVersion,
    hexes: Object.fromEntries(Object.entries(FULL_HONEYCOMB_BOARD.hexes).map(([key, hex]) => [key, { ...hex, verification: "verified" as const }])),
    edges: FULL_HONEYCOMB_BOARD.edges,
  };
  const disguised = { ...disguisedCore, contentHash: boardContentHash(disguisedCore) };
  const productionErrors = validateBoardDefinition(disguised, { production: true });
  assert.equal(productionErrors.length, Object.keys(FULL_HONEYCOMB_BOARD.hexes).length + FULL_HONEYCOMB_BOARD.edges.length);
  assert.equal(productionErrors.some((error) => error.includes("water class is unresolved")), true);
  assert.equal(productionErrors.some((error) => error.includes("barrier is unresolved")), true);
});

test("provisional authority passes the explicit provisional release gate but fails strict verified validation", () => {
  assert.equal(Object.keys(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).length, 254);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.version, 2);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.rulesetVersion, "playtest-0.3-physical-board-values");
  assert.equal(Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).every((hex) => hex.verification === "provisional"), true);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.edges.every((edge) => edge.enabled && edge.barrier === "none"), true);
  assert.deepEqual(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD), []);
  assert.deepEqual(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true }), []);
  assert.equal(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true }).length, 254);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes.city.length, 12);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["military-base"].length, 12);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["infamy-site"].length, 5);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["mutation-site"].length, 3);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["2,1"].label, "Provisional Seattle");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["-2,9"].label, "Provisional San Francisco");
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["-2,9"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }]);
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["12,3"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }]);
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["15,4"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 3 } }]);
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["10,7"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 1 } }]);
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
