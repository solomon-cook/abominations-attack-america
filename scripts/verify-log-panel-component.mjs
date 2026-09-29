import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React = React;
const { LogPanel } = await import("../apps/web/src/components/LogPanel.tsx");

const unknownActorId = "legacy-private-actor-id";
const renderEvent = (event) => renderToStaticMarkup(React.createElement(LogPanel, {
  participants: [],
  eventLog: [event],
  log: [],
}));

const localEventDetail = { message: "local event without actor", value: 17 };
const localHtml = renderEvent({
  id: "local-event-1",
  action: "turn.passed",
  outcome: "completed",
  detail: localEventDetail,
});
assert.match(localHtml, /<summary>turn\.passed · completed<\/summary>/, "local events without actor IDs must not get an actor prefix");
const localRenderedDetails = localHtml.match(/<pre>([\s\S]*?)<\/pre>/)?.[1]?.replaceAll("&quot;", '"');
assert.equal(localRenderedDetails, JSON.stringify(localEventDetail, null, 2), "local event details must remain unchanged");

const legacyEventDetail = { message: "historical event from an unknown actor", value: 23 };
const legacyHtml = renderEvent({
  id: "legacy-event-1",
  actorId: unknownActorId,
  action: "turn.passed",
  outcome: "completed",
  detail: legacyEventDetail,
});
assert.match(legacyHtml, /<summary>Player · turn\.passed · completed<\/summary>/, "unknown legacy actors must use a neutral label");
assert.equal(legacyHtml.includes(unknownActorId), false, "unknown legacy actor IDs must not be shown");
const legacyRenderedDetails = legacyHtml.match(/<pre>([\s\S]*?)<\/pre>/)?.[1]?.replaceAll("&quot;", '"');
assert.equal(legacyRenderedDetails, JSON.stringify(legacyEventDetail, null, 2), "legacy event details must remain unchanged");

console.log(JSON.stringify({
  ok: true,
  localUnsetActor: { actorPrefix: false, eventDetailPreserved: true },
  legacyUnknownActor: { fallbackLabel: "Player", opaqueActorIdHidden: true, eventDetailPreserved: true },
}));
