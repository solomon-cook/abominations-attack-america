import assert from "node:assert/strict";
import test from "node:test";
import { DEVELOPMENT_BOARD, FULL_HONEYCOMB_BOARD, PHOTOGRAPHED_BOARD_OVERLAYS, PROVISIONAL_AUTHORITATIVE_BOARD, boardContentHash, buildBoardIndex, diagnoseBoard, hexDistance, hexKey, hexKeyToLocationId, locationIdToHexKey, toDevelopmentSpaceKey, validateBoardDefinition } from "./board.js";

test("development board is structurally valid but not production-ready", () => {
  assert.deepEqual(validateBoardDefinition(DEVELOPMENT_BOARD), []);
  assert.equal(validateBoardDefinition(DEVELOPMENT_BOARD, { production: true }).length > 0, true);
  assert.equal(buildBoardIndex(DEVELOPMENT_BOARD).featureHexes.city.length, 5);
});

test("full-board candidate contains the complete honeycomb coordinate shell but remains blocked", () => {
  assert.equal(Object.keys(FULL_HONEYCOMB_BOARD.hexes).length, 336);
  const rows = new Map<number, number>();
  for (const hex of Object.values(FULL_HONEYCOMB_BOARD.hexes)) rows.set(hex.coord.r, (rows.get(hex.coord.r) ?? 0) + 1);
  assert.deepEqual([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, count]) => count), Array.from({ length: 14 }, () => 24));
  const qValues = Object.values(FULL_HONEYCOMB_BOARD.hexes).map((hex) => hex.coord.q);
  assert.equal(Math.min(...qValues), -6);
  assert.equal(Math.max(...qValues), 23);
  assert.equal(new Set(qValues).size, 30, "the staggered axial keys cover the complete 24-column rectangle");
  assert.equal(Object.values(FULL_HONEYCOMB_BOARD.hexes).every((hex) => hex.sourceRefs.some((ref) => ref.includes("source-photos-2026-08-26/full-board-setup.JPG"))), true);
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
  assert.equal(Object.keys(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).length, 336);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.version, 3);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.rulesetVersion, "playtest-0.4-physical-board-shell");
  assert.equal(Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).every((hex) => hex.verification === "provisional"), true);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.edges.every((edge) => edge.enabled && (edge.barrier === "none" || edge.barrier === "sea" || edge.barrier === "lake")), true);
  assert.equal(Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).filter((hex) => hex.waterClass === "lake").length, 8);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["2,1"].features[0]?.kind, "military-base");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["4,4"].features[0]?.kind, "mutation-site");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["4,4"].features[0]?.kind === "mutation-site" && PROVISIONAL_AUTHORITATIVE_BOARD.hexes["4,4"].features[0].siteId, "experimental-breeder-reactor");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["1,8"].label, "Provisional Phoenix");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.edges.some((edge) => edge.barrier === "sea"), true);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.edges.every((edge) => edge.barrier !== "sea" || !(PROVISIONAL_AUTHORITATIVE_BOARD.hexes[edge.from].waterClass === "sea" && PROVISIONAL_AUTHORITATIVE_BOARD.hexes[edge.to].waterClass === "sea")), true);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.edges.every((edge) => edge.barrier !== "lake" || !(PROVISIONAL_AUTHORITATIVE_BOARD.hexes[edge.from].waterClass === "lake" && PROVISIONAL_AUTHORITATIVE_BOARD.hexes[edge.to].waterClass === "lake")), true);
  assert.deepEqual(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD), []);
  assert.deepEqual(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true, allowProvisional: true }), []);
  assert.equal(validateBoardDefinition(PROVISIONAL_AUTHORITATIVE_BOARD, { production: true }).length, 336);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes.city.length, 44);
  assert.equal(Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).filter((hex) => hex.features.some((feature) => feature.kind === "city")).every((hex) => hex.label?.startsWith("Provisional ")), true);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["military-base"].length, 12);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["infamy-site"].length, 15);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes["mutation-site"].length, 4);
  assert.equal(buildBoardIndex(PROVISIONAL_AUTHORITATIVE_BOARD).featureHexes.lair.length, 6);
  assert.equal(Object.values(PROVISIONAL_AUTHORITATIVE_BOARD.hexes).every((hex) => hex.features.length === 0 || hex.waterClass !== "sea"), true);
  for (const key of ["1,3", "0,4", "13,3", "2,7", "10,7", "3,11"] as const) {
    assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes[key].features.some((feature) => feature.kind === "lair"), true);
  }
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["3,1"].label, "Provisional Seattle");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["1,2"].label, "Provisional Portland");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["1,2"].features[0]?.kind, "city");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["3,0"].label, "Provisional Vancouver");
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["3,0"].features, [{ kind: "city", benefit: { kind: "health", amount: 1 } }]);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["4,1"].features[0]?.kind, "infamy-site");
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["1,2"].features[0]?.kind, "city");
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["-5,10"].features, []);
  assert.deepEqual(PHOTOGRAPHED_BOARD_OVERLAYS, [{
    id: "hollywood",
    anchor: "-5,10",
    sourceRefs: ["references/monsters-menace-america/components/source-photos-2026-08-26/full-board-setup.JPG#provisional-feature-pass", "references/monsters-menace-america/components/source-photos-2026-08-26/full-board-setup.JPG#full-honeycomb-grid"],
    notes: "Printed Hollywood area/title overlay; do not expose the anchor as a visitable hex feature.",
  }]);
  assert.ok(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["2,0"]);
  assert.ok(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["1,2"]);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["-1,5"].label, "Provisional San Francisco");
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["-1,5"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }]);
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["13,4"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 2 } }]);
  assert.equal(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["19,4"].label, "Provisional New York");
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["19,4"].features, [{ kind: "city", benefit: { kind: "health-roll", dice: 3 } }]);
  assert.deepEqual(PROVISIONAL_AUTHORITATIVE_BOARD.hexes["4,4"].features, [{ kind: "mutation-site", siteId: "experimental-breeder-reactor" }]);
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
        features: [...sourceHex.features, { kind: "los-angeles" as const }]
      }
    },
    edges: DEVELOPMENT_BOARD.edges
  };
  const composite = { ...compositeCore, contentHash: boardContentHash(compositeCore) };
  assert.deepEqual(validateBoardDefinition(composite), []);
  assert.equal(buildBoardIndex(composite).featureHexes["los-angeles"].length, 1);
});
