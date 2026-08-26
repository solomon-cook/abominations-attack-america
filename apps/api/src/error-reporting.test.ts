import assert from "node:assert/strict";
import test from "node:test";
import { createErrorReporterSink, ErrorReporter } from "./error-reporting.js";

test("error reporter redacts token-bearing paths and emits bounded alerts", () => {
  const reports: Array<{ message: string; path?: string; alert?: boolean }> = [];
  let currentTime = 1_000;
  const reporter = new ErrorReporter((report) => reports.push(report), 2, 60_000, () => currentTime);
  const first = reporter.report({ category: "http", message: "Invalid token", path: "/rooms/ABC/state?token=secret&afterVersion=2" });
  reporter.report({ category: "persistence", message: "Database unavailable", path: "/rooms/ABC/state" });
  reporter.report({ category: "http", message: "Another failure", path: "/health" });
  currentTime += 60_000;
  reporter.report({ category: "http", message: "Fresh window failure", path: "/health" });
  reporter.report({ category: "http", message: "Fresh window failure", path: "/health" });
  assert.equal(first.path, "/rooms/ABC/state?token=[REDACTED]&afterVersion=2");
  assert.equal(reports.length, 5);
  assert.equal(reports[1]?.alert, true);
  assert.equal(reports[2]?.alert, undefined);
  assert.equal(reports[4]?.alert, true);
  assert.deepEqual(reporter.snapshot(), {
    reports: 5,
    alerts: 2,
    recentByCategory: { http: 4, command: 0, persistence: 1, websocket: 0, divergence: 0, deployment: 0 },
  });
});

test("error reporter preserves divergence and deployment categories for operational routing", () => {
  const reporter = new ErrorReporter(() => undefined);
  reporter.report({ category: "divergence", path: "/ws", message: "projection mismatch" });
  reporter.report({ category: "deployment", path: "/listen", message: "bind failed" });
  assert.deepEqual(reporter.snapshot().recentByCategory, { http: 0, command: 0, persistence: 0, websocket: 0, divergence: 1, deployment: 1 });
});

test("optional alert delivery sends only redacted threshold reports", async () => {
  const delivered: Array<{ input: string | URL; init?: RequestInit }> = [];
  const logs: string[] = [];
  const sink = createErrorReporterSink({
    endpoint: "https://alerts.example.test/ingest",
    log: (line) => logs.push(line),
    fetcher: async (input, init) => {
      delivered.push({ input, init });
      return new Response(null, { status: 202 });
    },
  });
  const reporter = new ErrorReporter(sink, 2, 60_000, () => 1_000);
  reporter.report({ category: "http", message: "token=secret", path: "/health" });
  reporter.report({ category: "http", message: "threshold", path: "/rooms/A/state?token=secret" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.input, "https://alerts.example.test/ingest");
  const body = JSON.parse(String(delivered[0]?.init?.body));
  assert.equal(body.message, "threshold");
  assert.equal(body.path, "/rooms/A/state?token=[REDACTED]");
  assert.equal(body.alert, true);
  assert.equal(logs.length, 2);
});
