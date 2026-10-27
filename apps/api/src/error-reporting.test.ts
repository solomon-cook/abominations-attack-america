import assert from "node:assert/strict";
import test from "node:test";
import { createDurableErrorAggregateWriter, createErrorReporterSink, ErrorReporter } from "./error-reporting.js";

test("error reporter alerts critical categories immediately and rate-limits each category", () => {
  const reports: Array<{ category: string; message: string; path?: string; alert?: boolean; alertCount?: number; alertThreshold?: number }> = [];
  let currentTime = 1_000;
  const reporter = new ErrorReporter((report) => reports.push(report), 3, 60_000, () => currentTime);
  const first = reporter.report({ category: "http", message: "Invalid token", path: "/rooms/ABC/state?token=secret&afterVersion=2" });
  reporter.report({ category: "persistence", message: "Database unavailable", path: "/health" });
  reporter.report({ category: "http", message: "Another failure", path: "/health" });
  reporter.report({ category: "http", message: "Third HTTP failure", path: "/health" });
  reporter.report({ category: "divergence", message: "Projection mismatch", path: "/ws" });
  reporter.report({ category: "divergence", message: "Projection mismatch", path: "/ws" });
  currentTime += 60_000;
  reporter.report({ category: "divergence", message: "Fresh-window projection mismatch", path: "/ws" });
  assert.equal(first.path, "/rooms/ABC/state?token=[REDACTED]&afterVersion=2");
  assert.equal(reports.length, 7);
  assert.equal(reports[1]?.alert, true);
  assert.equal(reports[1]?.alertThreshold, 1);
  assert.equal(reports[2]?.alert, undefined);
  assert.equal(reports[3]?.alert, true);
  assert.equal(reports[3]?.alertCount, 3);
  assert.equal(reports[4]?.alert, true);
  assert.equal(reports[5]?.alert, undefined);
  assert.equal(reports[6]?.alert, true);
  assert.deepEqual(reporter.snapshot(), {
    reports: 7,
    alerts: 4,
    recentByCategory: { http: 3, command: 0, persistence: 1, websocket: 0, divergence: 3, deployment: 0 },
  });
});

test("error reporter preserves divergence and deployment categories for operational routing", () => {
  const reporter = new ErrorReporter(() => undefined);
  reporter.report({ category: "divergence", path: "/ws", message: "projection mismatch" });
  reporter.report({ category: "deployment", path: "/listen", message: "bind failed" });
  assert.deepEqual(reporter.snapshot().recentByCategory, { http: 0, command: 0, persistence: 0, websocket: 0, divergence: 1, deployment: 1 });
});

test("optional alert delivery sends only low-detail threshold metadata", async () => {
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
  assert.deepEqual(body, {
    event: "alert.error-threshold",
    category: "http",
    at: "1970-01-01T00:00:01.000Z",
    count: 2,
    threshold: 2,
  });
  assert.equal(JSON.stringify(body).includes("ABCD"), false);
  assert.equal(JSON.stringify(body).includes("secret"), false);
  assert.equal(delivered[0]?.init?.signal instanceof AbortSignal, true);
  assert.equal(logs.length, 2);
});

test("alert delivery is bounded and failure logs redact webhook credentials", async () => {
  const logs: string[] = [];
  const sink = createErrorReporterSink({
    endpoint: "https://alerts.example.test/hook?token=endpoint-secret",
    deliveryTimeoutMs: 5,
    log: (line) => logs.push(line),
    fetcher: (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new Error("aborted"));
      else signal?.addEventListener("abort", () => reject(new Error("failed https://alerts.example.test/hook?token=endpoint-secret")), { once: true });
    }),
  });
  sink({ category: "deployment", message: "bind failure", alert: true, alertCount: 1, alertThreshold: 1, at: "2026-10-08T12:00:00.000Z" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(logs.some((line) => line.includes("error alert delivery failed")));
  assert.equal(logs.join("\n").includes("endpoint-secret"), false);
});

test("durable error aggregation retains only category and UTC day", async () => {
  const aggregates: { category: string; bucketDate: string }[] = [];
  const logs: string[] = [];
  const sink = createErrorReporterSink({
    log: (line) => logs.push(line),
    persistAggregate: async (aggregate) => { aggregates.push(aggregate); },
  });

  sink({ category: "persistence", message: "private room failure", roomCode: "ABCD", at: "2026-10-08T23:59:59.000Z" });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(aggregates, [{ category: "persistence", bucketDate: "2026-10-08" }]);
  assert.equal(JSON.stringify(aggregates).includes("ABCD"), false);
  assert.equal(JSON.stringify(aggregates).includes("private room failure"), false);
  assert.equal(logs.length, 1);
});

test("durable error aggregation uses atomic category increments and a 90-day retention boundary", async () => {
  const operations: unknown[] = [];
  const persist = createDurableErrorAggregateWriter({
    increment: async (input) => { operations.push({ type: "increment", input }); },
    pruneBefore: async (bucketDate) => { operations.push({ type: "prune", bucketDate }); },
  });

  await persist({ category: "divergence", bucketDate: "2026-10-08" });

  assert.deepEqual(operations, [
    { type: "increment", input: { category: "divergence", bucketDate: "2026-10-08" } },
    { type: "prune", bucketDate: "2026-07-10" },
  ]);
  await assert.rejects(() => persist({ category: "divergence", bucketDate: "2026-02-30" }), /invalid/);
});
