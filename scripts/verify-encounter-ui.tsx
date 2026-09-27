import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AUDITED_BOARD, createGame, type GameLogEntry, type HexKey } from "../packages/game-engine/src/index.js";
import { isRoutineCityStompEvent, pendingRoutineCityStomp } from "../apps/web/src/routine-stomp.js";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { EncounterOverlay } = require("../apps/web/src/components/EncounterOverlay.tsx") as typeof import("../apps/web/src/components/EncounterOverlay");
const base = {
  open: true,
  canAct: true,
  monsterName: "Zorb",
  locationName: "Los Angeles",
  eventId: "resolved-event",
  baselineEventId: "baseline-event",
  effects: [{ type: "health", amount: 3, source: "Encounter" }],
  rolls: [],
  onReveal: () => undefined,
  onChoice: () => undefined,
  onClose: () => undefined,
};
const render = (props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(EncounterOverlay, { ...base, ...props }));

const routine = render({ choices: [], mutationDraws: [] });
assert.match(routine, /Encounter resolved/);
assert.match(routine, /\+3/);
assert.match(routine, /Return to board/);

const choice = render({ pendingChoice: true, choices: ["health", "infamy"], choiceSource: "iron-stomach", mutationDraws: [] });
assert.match(choice, /Choose your reward/i);
assert.match(choice, /Take 3 Health/);
assert.match(choice, /Take 1 Infamy/);

const card = render({ choices: [], mutationDraws: [{ siteId: "los-angeles", cardDrawn: true, effectStatus: "implemented" }], mutationCardId: "Cellular Regeneration" });
assert.match(card, /Reveal card/);
assert.doesNotMatch(card, /class="cinema-primary"[^>]*>Return to board/);

const simpleCity = Object.entries(AUDITED_BOARD.hexes).find(([, hex]) => hex.features.some((feature) => feature.kind === "city")
  && !hex.features.some((feature) => feature.kind === "mutation-site" || feature.kind === "challenge-site" || feature.kind === "military-base"));
assert.ok(simpleCity, "the audited board fixture should contain a city without card, challenge, or base choices");
const cityLocation = simpleCity[0] as HexKey;
const cityFeature = simpleCity[1].features.find((feature) => feature.kind === "city");
assert.ok(cityFeature?.kind === "city");
const stompGame = createGame(2);
stompGame.currentPlayer = 0;
stompGame.phase = "encounter";
stompGame.monsters[0]!.name = "Konk";
stompGame.monsters[0]!.location = cityLocation;
stompGame.pendingDecision = { type: "encounter-resolution", playerIndex: 0, location: cityLocation };
stompGame.stompedLocations = [];
stompGame.eventLog = [];
const cityPrompt = pendingRoutineCityStomp(stompGame, AUDITED_BOARD);
assert.ok(cityPrompt, "an active player should get the compact city-stomp prompt");
assert.equal(cityPrompt.dice, cityFeature.benefit.kind === "health-roll" ? cityFeature.benefit.dice : 0);
const stompEvent: GameLogEntry = {
  id: "routine-stomp",
  action: "encounter.resolved",
  outcome: "City stomp resolved",
  detail: { playerIndex: 0, monsterId: stompGame.monsters[0]!.id, location: cityLocation, stomped: true, effects: [{ type: "stomp", amount: 1, source: "City" }], mutationDraws: [] },
};
assert.equal(isRoutineCityStompEvent(stompEvent, [stompEvent], AUDITED_BOARD), true, "plain city stomps should use board playback");
assert.equal(isRoutineCityStompEvent({ ...stompEvent, detail: { ...stompEvent.detail, mutationDraws: [{ cardDrawn: true }] } }, [stompEvent], AUDITED_BOARD), false, "a stomp that reveals a Mutation card should keep the Encounter panel");
assert.equal(isRoutineCityStompEvent({ ...stompEvent, detail: { ...stompEvent.detail, challenge: { declared: true, active: false } } }, [stompEvent], AUDITED_BOARD), false, "a stomp that declares a Monster Challenge should keep the Encounter panel");
const fightBeforeStomp: GameLogEntry = { id: "city-fight", action: "fight.resolved", outcome: "Fight resolved", detail: { battleId: `${stompGame.monsters[0]!.id}:${stompGame.round}:${cityLocation}` } };
assert.equal(isRoutineCityStompEvent(stompEvent, [fightBeforeStomp, stompEvent], AUDITED_BOARD), false, "a city stomp after a fight should keep the Encounter panel");
stompGame.eventLog.push(fightBeforeStomp);
assert.equal(pendingRoutineCityStomp(stompGame, AUDITED_BOARD), undefined, "a city stomp following a fight should not open the compact prompt");
stompGame.stompMarkers = 1;
stompGame.eventLog = [];
assert.equal(pendingRoutineCityStomp(stompGame, AUDITED_BOARD), undefined, "the final stomp should keep its Monster Challenge declaration in the Encounter panel");

console.log("PASS: city stomps without fights or card reveals use the compact board flow; choices and Mutation reveals retain the Encounter panel.");
