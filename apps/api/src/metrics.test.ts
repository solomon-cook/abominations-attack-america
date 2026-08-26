import assert from "node:assert/strict";
import test from "node:test";
import { ApiMetrics } from "./metrics.js";

test("metrics record operational counters and return an isolated snapshot", () => {
  const metrics = new ApiMetrics();
  metrics.request();
  metrics.commandAccepted();
  metrics.reconnect();
  metrics.websocketConnection();
  metrics.roomCompleted();
  metrics.latency(12);
  metrics.latency(8);
  metrics.errorReport("command");
  metrics.errorReport("divergence");
  metrics.errorReport("deployment");
  const snapshot = metrics.snapshot();
  assert.deepEqual(snapshot, {
    requests: 1,
    requestFailures: 0,
    commandAccepted: 1,
    commandFailed: 0,
    reconnects: 1,
    websocketConnections: 1,
    websocketFailures: 0,
    roomsCompleted: 1,
    roomsAbandoned: 0,
    latencySamples: 2,
    latencyTotalMs: 20,
    serverErrors: 0,
    errorReports: 3,
    divergenceReports: 1,
    deploymentFailures: 1,
  });
  snapshot.requests = 99;
  assert.equal(metrics.snapshot().requests, 1);
});
