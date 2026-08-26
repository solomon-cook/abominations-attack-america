import { spawn } from "node:child_process";
import process from "node:process";
import { join } from "node:path";

const webPort = Number(process.env.SAFARI_WEB_PORT ?? 5194);
const driverPort = Number(process.env.WEBDRIVER_PORT ?? process.env.SAFARI_DRIVER_PORT ?? 4444);
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${webPort}/`;
const timeoutMs = Number(process.env.SAFARI_BROWSER_TIMEOUT_MS ?? 20_000);
const strict = process.env.SAFARI_REQUIRE_SESSION === "1";
const driverCommand = process.env.WEBDRIVER_COMMAND ?? "safaridriver";
const browserName = process.env.WEBDRIVER_BROWSER ?? "safari";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const web = spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(webPort)], {
  cwd: join(process.cwd(), "apps/web"),
  stdio: ["ignore", "pipe", "pipe"],
});
let webOutput = "";
web.stdout.on("data", (chunk) => { webOutput += chunk.toString(); });
web.stderr.on("data", (chunk) => { webOutput += chunk.toString(); });

const driver = spawn(driverCommand, ["--port", String(driverPort)], { stdio: ["ignore", "pipe", "pipe"] });
let driverOutput = "";
driver.stdout.on("data", (chunk) => { driverOutput += chunk.toString(); });
driver.stderr.on("data", (chunk) => { driverOutput += chunk.toString(); });

const stop = (child) => new Promise((resolve) => {
  if (child.exitCode !== null) {
    resolve();
    return;
  }
  const forceStop = setTimeout(() => {
    child.kill("SIGKILL");
    resolve();
  }, 2_000);
  child.once("exit", () => {
    clearTimeout(forceStop);
    resolve();
  });
  child.kill("SIGTERM");
});

const request = async (port, path, init, requestTimeoutMs = timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const waitFor = async (check, description) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      if (await check()) return;
    } catch {
      // The service is still starting.
    }
    await wait(100);
  }
  throw new Error(`${description} did not become ready.`);
};

let sessionId;
let result = { ok: false, webReady: false, driverReady: false, session: "unavailable", review: "unavailable", browser: browserName, driverCommand, url, webPort, driverPort };
try {
  await waitFor(async () => {
    const response = await fetch(url);
    return response.ok;
  }, `Vite at ${url}`);
  result.webReady = true;

  await waitFor(async () => (await request(driverPort, "/status", undefined, 1_000)).ok, "SafariDriver");
  result.driverReady = true;

  const created = await request(driverPort, "/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ capabilities: { alwaysMatch: { browserName, acceptInsecureCerts: true, ...(browserName === "firefox" ? { "moz:firefoxOptions": { args: ["-headless"] } } : {}) } } }),
  });
  const createdBody = await created.json();
  sessionId = createdBody.value?.sessionId;
  if (!created.ok || !sessionId) {
    result.session = "rejected";
    result.detail = JSON.stringify(createdBody);
  } else {
    result.session = "created";
    const navigate = await request(driverPort, `/session/${sessionId}/url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!navigate.ok) throw new Error(`Safari navigation failed: ${await navigate.text()}`);
    await wait(500);
    const clickReview = await request(driverPort, `/session/${sessionId}/execute/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script: "const reviewButton = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Review full board shell')); if (!reviewButton) throw new Error('Review full board shell control not found.'); reviewButton.click(); return true;",
        args: [],
      }),
    });
    if (!clickReview.ok) throw new Error(`Safari review navigation failed: ${await clickReview.text()}`);
    await wait(500);
    const inspected = await request(driverPort, `/session/${sessionId}/execute/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        script: "return { reviewScreen: Boolean(document.querySelector('.board-review-screen')), cellCount: document.querySelectorAll('.board-review-hex').length, sourceCount: document.querySelectorAll('.board-review-source img').length, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };",
        args: [],
      }),
    });
    const inspectedBody = await inspected.json();
    const value = inspectedBody.value?.value ?? inspectedBody.value;
    if (!inspected.ok || !value?.reviewScreen || value.cellCount !== 254 || value.sourceCount !== 2 || value.horizontalOverflow) {
      result.review = "failed";
      result.detail = JSON.stringify(value ?? inspectedBody);
    } else {
      result.review = "passed";
    }
  }
  result.ok = result.webReady && result.driverReady && result.session === "created" && result.review === "passed";
} catch (error) {
  result.detail = error instanceof Error ? error.message : String(error);
} finally {
  if (sessionId) await request(driverPort, `/session/${sessionId}`, { method: "DELETE" }, 3_000).catch(() => {});
  await stop(driver);
  await stop(web);
}

if (!result.ok && !result.detail) result.detail = `${driverOutput.trim()}${webOutput.trim()}`.trim() || "Safari compatibility check did not complete.";
console.log(JSON.stringify(result));
if (strict && !result.ok) process.exitCode = 1;
