import { spawn } from "node:child_process";
import process from "node:process";

const port = Number(process.env.SAFARI_DRIVER_PORT ?? 4444);
const timeoutMs = Number(process.env.SAFARI_DRIVER_TIMEOUT_MS ?? 15_000);
const strict = process.env.SAFARI_REQUIRE_SESSION === "1";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const driver = spawn("safaridriver", ["--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
driver.stdout.on("data", (chunk) => { output += chunk.toString(); });
driver.stderr.on("data", (chunk) => { output += chunk.toString(); });
const stop = () => new Promise((resolve) => {
  if (driver.exitCode !== null) {
    resolve();
    return;
  }
  const forceStop = setTimeout(() => {
    driver.kill("SIGKILL");
    resolve();
  }, 2000);
  driver.once("exit", () => {
    clearTimeout(forceStop);
    resolve();
  });
  driver.kill("SIGTERM");
});
const request = async (path, init, requestTimeoutMs = timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

let driverReady = false;
let session = "unavailable";
let detail = "";
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await request("/status", undefined, 1000);
      if (response.ok) {
        driverReady = true;
        break;
      }
    } catch {
      // SafariDriver is still starting.
    }
    await wait(100);
  }
  if (!driverReady) {
    detail = output.trim() || "SafariDriver did not expose /status.";
  } else {
    try {
      const response = await request("/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: "safari", acceptInsecureCerts: true } } }),
      });
      const body = await response.json();
      if (response.ok && body.value?.sessionId) {
        session = "created";
        await request(`/session/${body.value.sessionId}`, { method: "DELETE" }, 3000).catch(() => {});
      } else {
        session = "rejected";
        detail = JSON.stringify(body);
      }
    } catch (error) {
      session = error?.name === "AbortError" ? "timeout" : "error";
      detail = error instanceof Error ? error.message : String(error);
    }
  }
  console.log(JSON.stringify({ ok: driverReady && session === "created", driverReady, session, port, timeoutMs, detail: detail || undefined }));
  if (strict && (!driverReady || session !== "created")) process.exitCode = 1;
} finally {
  await stop();
}
