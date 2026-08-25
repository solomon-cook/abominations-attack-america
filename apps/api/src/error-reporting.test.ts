import assert from "node:assert/strict";
import test from "node:test";
import { ErrorReporter } from "./error-reporting.js";

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
