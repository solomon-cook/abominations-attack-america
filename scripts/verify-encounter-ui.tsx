import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const choice = render({ choices: ["health", "infamy"], choiceSource: "iron-stomach", mutationDraws: [] });
assert.match(choice, /Choose your reward/i);
assert.match(choice, /Take 3 Health/);
assert.match(choice, /Take 1 Infamy/);

const card = render({ choices: [], mutationDraws: [{ siteId: "los-angeles", cardDrawn: true, effectStatus: "implemented" }], mutationCardId: "Cellular Regeneration" });
assert.match(card, /Reveal card/);
assert.doesNotMatch(card, /class="cinema-primary"[^>]*>Return to board/);

console.log("PASS: routine encounters stay compact, Iron Stomach rewards remain explicit, and mutation rewards wait behind an inspectable card reveal.");
