import { spawn } from "node:child_process";
import process from "node:process";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";

const port = Number(process.env.BROWSER_CI_PORT ?? 5190);
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const parseJsonRecord = (output) => JSON.parse(output.trim().split(/\r?\n/).filter((line) => line.trim().startsWith("{")).at(-1));
const server = spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const freePort = () => new Promise((resolve, reject) => {
  const probe = createNetServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string") {
      probe.close();
      reject(new Error("Could not determine a free browser debug port."));
      return;
    }
    probe.close((error) => error ? reject(error) : resolve(address.port));
  });
});
const stopServer = () => new Promise((resolve) => {
  if (server.exitCode !== null) {
    resolve();
    return;
  }
  const forceStop = setTimeout(() => {
    server.kill("SIGKILL");
    resolve();
  }, 2000);
  server.once("exit", () => {
    clearTimeout(forceStop);
    resolve();
  });
  server.kill("SIGTERM");
});
const waitForServer = async () => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      // Vite is still starting.
    }
    await wait(100);
  }
  throw new Error(`Vite did not become ready at ${url}.\n${serverOutput}`);
};

const runMatrix = async () => {
  const debugPort = await freePort();
  return new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/verify-browser-local-matrix.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER_TEST_URL: url, BROWSER_DEBUG_PORT: String(debugPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve(output.trim());
    else reject(new Error(`CI browser matrix failed (code ${code ?? "none"}, signal ${signal ?? "none"})\n${output}`));
  });
  });
};

const runBoardReview = ({ name, width, height, debugPort }) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/verify-browser-board-review.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER_TEST_URL: url, BROWSER_TEST_WIDTH: String(width), BROWSER_TEST_HEIGHT: String(height), BROWSER_DEBUG_PORT: String(debugPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve(output.trim());
    else reject(new Error(`CI board review ${name} failed (code ${code ?? "none"}, signal ${signal ?? "none"})\n${output}`));
  });
});

try {
  await waitForServer();
  const boardReview = [];
  for (const viewport of [["desktop", 1280, 720], ["tablet", 834, 1112], ["mobile", 390, 844]]) {
    boardReview.push(parseJsonRecord(await runBoardReview({ name: viewport[0], width: viewport[1], height: viewport[2], debugPort: await freePort() })));
  }
  const output = await runMatrix();
  console.log(JSON.stringify({ boardReview, matrix: parseJsonRecord(output) }));
} finally {
  await stopServer();
}
