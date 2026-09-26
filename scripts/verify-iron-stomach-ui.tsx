import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { EncounterOverlay } = require("../apps/web/src/components/EncounterOverlay.tsx") as typeof import("../apps/web/src/components/EncounterOverlay.js");

const html = renderToStaticMarkup(React.createElement(EncounterOverlay, {
  open: true,
  canAct: true,
  monsterName: "Zorb",
  locationName: "Denver Military Base",
  eventId: "iron-stomach-choice",
  baselineEventId: "before-choice",
  effects: [],
  rolls: [],
  choices: ["health", "infamy"],
  choiceSource: "iron-stomach",
  mutationDraws: [],
  onReveal: () => undefined,
  onChoice: () => undefined,
  onClose: () => undefined,
}));

assert.match(html, /Keep 3 Health or take 1 Infamy for stomping this base\./);
assert.match(html, /Take 3 Health/);
assert.match(html, /Take 1 Infamy/);
assert.doesNotMatch(html, /Take 2 Infamy/);
console.log("Iron Stomach's encounter choice presents the correct +3 Health and +1 Infamy base rewards.");
