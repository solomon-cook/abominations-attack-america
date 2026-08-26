import { spawn } from "node:child_process";
import process from "node:process";
import { join } from "node:path";

const port = Number(process.env.BROWSER_CI_PORT ?? 5190);
const url = process.env.BROWSER_TEST_URL ?? `http://127.0.0.1:${port}/`;
const parseJsonRecord = (output) => JSON.parse(output.trim().split(/\r?\n/).filter((line) => line.trim().startsWith("{")).at(-1));
const server = spawn(process.execPath, [join(process.cwd(), "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port)], { cwd: join(process.cwd(), "apps/web"), stdio: ["ignore", "pipe", "pipe"] });
let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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

const runMatrix = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/verify-browser-local-matrix.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER_TEST_URL: url, BROWSER_DEBUG_PORT: String(Number(process.env.BROWSER_CI_DEBUG_PORT ?? 9239)) },
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

const runBoardReview = () => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ["scripts/verify-browser-board-review.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER_TEST_URL: url, BROWSER_DEBUG_PORT: String(Number(process.env.BROWSER_CI_DEBUG_PORT ?? 9239) + 1) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code === 0) resolve(output.trim());
    else reject(new Error(`CI board review failed (code ${code ?? "none"}, signal ${signal ?? "none"})\n${output}`));
  });
});

try {
  await waitForServer();
  const boardReview = await runBoardReview();
  const output = await runMatrix();
  console.log(JSON.stringify({ boardReview: parseJsonRecord(boardReview), matrix: parseJsonRecord(output) }));
} finally {
  await stopServer();
}
