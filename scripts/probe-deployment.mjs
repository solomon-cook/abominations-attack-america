const baseUrl = process.env.DEPLOYMENT_BASE_URL?.replace(/\/+$/, "");
const timeoutMs = Number(process.env.DEPLOYMENT_PROBE_TIMEOUT_MS ?? 10_000);

if (!baseUrl) {
  console.error("DEPLOYMENT_BASE_URL is required; no deployment probe was run.");
  process.exitCode = 2;
} else {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" && process.env.ALLOW_HTTP_DEPLOYMENT_PROBE !== "1") {
    throw new Error("Deployment probe requires an HTTPS base URL; set ALLOW_HTTP_DEPLOYMENT_PROBE=1 only for an explicit local probe.");
  }

  async function getJson(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal, headers: { accept: "application/json" } });
      let body;
      try { body = await response.json(); } catch { throw new Error(`${path} returned non-JSON content (HTTP ${response.status})`); }
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  const health = await getJson("/api/health");
  if (health?.ok !== true) throw new Error("/api/health did not report ok=true");
  if (health?.persistence === "convex") {
    if (health?.realtimeFanout?.mode !== "reactive-subscription" || health.realtimeFanout.ready !== true) throw new Error("/api/health did not report ready Convex reactive subscriptions");
    const rooms = await getJson("/api/rooms/public");
    if (!Array.isArray(rooms)) throw new Error("/api/rooms/public did not return a list");
    const leaderboard = await getJson("/api/leaderboard");
    if (!Array.isArray(leaderboard)) throw new Error("/api/leaderboard did not return a list");
    console.log(JSON.stringify({ ok: true, baseUrl: parsed.origin, health: { ok: health.ok, persistence: health.persistence, realtimeFanout: health.realtimeFanout }, publicRooms: rooms.length, leaderboardEntries: leaderboard.length }));
  } else {
    if (health?.persistence !== "prisma") throw new Error(`/api/health reported persistence=${String(health?.persistence)}; expected Prisma or Convex`);
    if (health?.realtimeFanout?.mode !== "http-polling" || health.realtimeFanout.ready !== true) throw new Error("/api/health did not report ready HTTP polling fanout");
    const metrics = await getJson("/api/metrics");
    const metricKeys = ["requests", "requestFailures", "commandAccepted", "commandFailed", "reconnects", "websocketConnections", "websocketFailures", "roomsCompleted", "roomsAbandoned", "latencySamples", "latencyTotalMs", "serverErrors", "errorReports", "divergenceReports", "deploymentFailures"];
    for (const key of metricKeys) if (!Number.isFinite(metrics?.[key]) || metrics[key] < 0) throw new Error(`/metrics has invalid ${key}`);
    console.log(JSON.stringify({ ok: true, baseUrl: parsed.origin, health: { ok: health.ok, persistence: health.persistence, realtimeFanout: health.realtimeFanout }, metrics: { keys: metricKeys.length, requests: metrics.requests, serverErrors: metrics.serverErrors } }));
  }
}
