import assert from "node:assert/strict";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
require.extensions[".css"] = () => undefined;
const { TurnPrompt } = require("../apps/web/src/components/TurnPrompt.tsx") as typeof import("../apps/web/src/components/TurnPrompt.js");

const html = renderToStaticMarkup(React.createElement(TurnPrompt, {
  action: "Move",
  description: "Move your monster.",
  rulesHelp: { title: "Move", body: "Choose a legal destination." },
  unavailableReason: "",
  canAct: true,
  lastFightRolls: [],
  lastFightOutcomes: [],
  lastRecoveryEventId: "turn-start-atomic-recovery",
  lastAtomicRecovery: true,
}));
assert.match(html, /TURN-START RECOVERY/);
assert.match(html, /Atomic Recovery restored the monster to its starting Health\./);
console.log("The Move prompt visibly reports Atomic Recovery when the monster heals at turn start.");
