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

  const health = await getJson("/health");
  if (health?.ok !== true) throw new Error("/health did not report ok=true");
  if (health?.persistence !== "prisma") throw new Error(`/health reported persistence=${String(health?.persistence)}; deployment probe requires Prisma`);

  const metrics = await getJson("/metrics");
  const metricKeys = ["requests", "requestFailures", "commandAccepted", "commandFailed", "reconnects", "websocketConnections", "websocketFailures", "roomsCompleted", "roomsAbandoned", "latencySamples", "latencyTotalMs", "serverErrors", "errorReports", "divergenceReports", "deploymentFailures"];
  for (const key of metricKeys) if (!Number.isFinite(metrics?.[key]) || metrics[key] < 0) throw new Error(`/metrics has invalid ${key}`);

  console.log(JSON.stringify({ ok: true, baseUrl: parsed.origin, health: { ok: health.ok, persistence: health.persistence }, metrics: { keys: metricKeys.length, requests: metrics.requests, serverErrors: metrics.serverErrors } }));
}
