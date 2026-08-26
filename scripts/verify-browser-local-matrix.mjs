import { spawn } from "node:child_process";
import process from "node:process";

const cases = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
];

function runCase(testCase) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-browser-local.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BROWSER_TEST_WIDTH: String(testCase.width),
        BROWSER_TEST_HEIGHT: String(testCase.height),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`${testCase.name} browser smoke failed (code ${code ?? "none"}, signal ${signal ?? "none"})\n${stdout}${stderr}`));
        return;
      }
      resolve({ ...testCase, output: stdout.trim() });
    });
  });
}

const results = [];
for (const testCase of cases) results.push(await runCase(testCase));
console.log(JSON.stringify({ ok: true, cases: results }));
